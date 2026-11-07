// Evening out a split of the grid: Groups side by side, or one above another, as dockview's
// grid nests them. Its splits have no API of their own; their Groups do.

import type { DockviewApi } from "dockview-react";

/** A node of dockview's grid, as `toJSON` gives it: a Group (`leaf`) or a split (`branch`). */
export interface GridNode {
  type: "leaf" | "branch";
  data: { id: string } | GridNode[];
  size?: number; // along the split it is in
}

/** The grid as `toJSON` gives it: the top split, and whether it lays its parts out side by side. */
export interface Grid {
  root: GridNode;
  orientation: string; // "HORIZONTAL": side by side
}

/** The node at a location: the indexes of its parts down from the top, as dockview's are. */
export function nodeAt(root: GridNode, location: readonly number[]): GridNode | undefined {
  let node: GridNode | undefined = root;
  for (const index of location) node = Array.isArray(node?.data) ? node.data[index] : undefined;
  return node;
}

/** Whether a split at this depth lays its parts out side by side: the top's way, every other one. */
export function sideBySide(orientation: string, depth: number): boolean {
  return (orientation === "HORIZONTAL") === (depth % 2 === 0);
}

/** A split's parts' Groups that are its own parts, not within splits of it: by their IDs. */
export function ownGroups(split: GridNode): string[] {
  if (!Array.isArray(split.data)) return [];
  return split.data.flatMap((part) => (Array.isArray(part.data) ? [] : [part.data.id]));
}

/**
 * For each of a split's parts but the last, a Group whose size across the split is the part's:
 * the part, or one of the part's own Groups; `undefined` where it has none.
 */
export function partHandles(split: GridNode): (string | undefined)[] {
  if (!Array.isArray(split.data)) return [];
  return split.data
    .slice(0, -1)
    .map((part) => (Array.isArray(part.data) ? ownGroups(part)[0] : part.data.id));
}

/**
 * Evens out the parts of the split at a location, each as wide (side by side) or as high as the
 * others; the splits within them keep theirs. Dockview evens out a split's parts as a Group is
 * added to it and removed, so this does that, beside one of its own Groups, or at the edge of
 * the top; else it sizes each part through a Group of its own.
 */
export function evenOut(api: DockviewApi, location: readonly number[]): void {
  const grid: Grid = api.toJSON().grid;
  const split = nodeAt(grid.root, location);
  if (split === undefined || !Array.isArray(split.data) || split.data.length < 2) return;
  const across = sideBySide(grid.orientation, location.length);
  const options = { direction: across ? "right" : "below", skipSetActive: true } as const;
  const own = api.getGroup(ownGroups(split)[0] ?? "");
  if (own !== undefined || location.length === 0) {
    const added = own
      ? api.addGroup({ ...options, referenceGroup: own.id })
      : api.addGroup(options);
    api.removeGroup(added);
    return;
  }
  const each = split.data.reduce((sum, part) => sum + (part.size ?? 0), 0) / split.data.length;
  for (const id of partHandles(split)) {
    api.getGroup(id ?? "")?.api.setSize(across ? { width: each } : { height: each });
  }
}
