// Columns of Groups, side by side, as the title bar's buttons make them: every tab dealt
// among them in reading order, so that going from one count to another and back gives the same
// Groups again, while no tab opens, closes or moves in between.

import type { DockviewApi, DockviewGroupPanel } from "dockview-react";
import { keep } from "./dock";
import { evenOut, type Grid, type GridNode } from "./splits";

/** The counts of columns the title bar offers. */
export const COUNTS = [1, 2, 3, 4] as const;

/** The Groups' IDs in reading order: left to right, top to bottom, within splits as without. */
export function readingOrder(node: GridNode): string[] {
  return Array.isArray(node.data) ? node.data.flatMap(readingOrder) : [node.data.id];
}

/** How many columns side by side the grid has at its top: rows within them do not count. */
export function columnCount({ root, orientation }: Grid): number {
  if (!Array.isArray(root.data)) return 1;
  return orientation === "HORIZONTAL" ? root.data.length : Math.min(root.data.length, 1);
}

/**
 * Cuts the items into `count` runs, in their order, lengths differing by at most one, the
 * longer ones first; with fewer items than runs, the last runs are empty.
 */
export function deal<T>(items: readonly T[], count: number): T[][] {
  const short = Math.floor(items.length / count);
  const long = items.length % count; // runs one longer
  const runs: T[][] = [];
  let at = 0;
  for (let run = 0; run < count; run++) {
    const length = short + (run < long ? 1 : 0);
    runs.push(items.slice(at, at + length));
    at += length;
  }
  return runs;
}

/** A Group as dealing sees it: its Panels in tab order, and the one it shows. */
export interface GroupTabs {
  id: string;
  panels: readonly string[];
  shown: string | undefined;
}

/** A column to make: the Group to reuse, or none for a new one; its Panels, and the one shown. */
export interface Column {
  group: string | null;
  panels: string[];
  shown: string | undefined;
}

/**
 * The columns for the Groups' tabs, the Groups in reading order: their tabs dealt into `count`
 * runs. Each run reuses its first tab's Group, unless an earlier run did, so that the Group
 * keeps its steps back and forward; it shows the first of its tabs that was shown, else its first.
 */
export function arrange(groups: readonly GroupTabs[], count: number): Column[] {
  const owner = new Map(groups.flatMap((group) => group.panels.map((panel) => [panel, group.id])));
  const shown = new Set(groups.map((group) => group.shown));
  const taken = new Set<string>();
  return deal(
    groups.flatMap((group) => group.panels),
    count,
  ).map((panels) => {
    const first = panels[0] === undefined ? undefined : owner.get(panels[0]);
    const group = first !== undefined && !taken.has(first) ? first : null;
    if (group !== null) taken.add(group);
    return { group, panels, shown: panels.find((panel) => shown.has(panel)) ?? panels[0] };
  });
}

/**
 * Makes `count` columns of Groups side by side, of equal widths, with all tabs dealt among them
 * (`arrange`), each tab kept, none a preview. Where the grid has as many already, it only
 * evens out their widths, keeping any rows within them.
 */
export function arrangeColumns(api: DockviewApi, count: number): void {
  const grid = api.toJSON().grid;
  if (columnCount(grid) === count) {
    evenOut(api, []);
    return;
  }
  const focused = api.activePanel?.id;
  const groups = readingOrder(grid.root).flatMap((id) => {
    const group = api.getGroup(id);
    if (group === undefined) return [];
    const panels = group.panels.map((panel) => panel.id);
    return [{ id, panels, shown: group.activePanel?.id }];
  });
  const columns = arrange(groups, count);
  // At the top's right end, for the columns to be placed before it, in order; removed after.
  const end = api.addGroup({ direction: "right", skipSetActive: true });
  const made: DockviewGroupPanel[] = columns.map((column) => {
    const reused = api.groups.find((group) => group.id === column.group);
    return reused ?? api.addGroup({ referenceGroup: end, direction: "left", skipSetActive: true });
  });
  // A run's first tab is in its Group already, and only leaves it for its own run, so no Group
  // made a column empties on the way.
  columns.forEach((column, at) => {
    column.panels.forEach((id, index) => {
      const panel = api.getPanel(id);
      keep(panel);
      panel?.api.moveTo({ group: made[at], index, skipSetActive: true });
    });
  });
  for (const group of [...api.groups]) {
    if (group !== end && !made.includes(group)) api.removeGroup(group);
  }
  for (const group of made) group.api.moveTo({ group: end, position: "left", skipSetActive: true });
  api.removeGroup(end);
  columns.forEach((column) => {
    if (column.shown) api.getPanel(column.shown)?.api.setActive();
  });
  (api.getPanel(focused ?? "") ?? made[0]?.activePanel)?.api.setActive();
}
