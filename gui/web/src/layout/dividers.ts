// Double-clicking a divider between Groups evens out the split it divides (`splits.ts`): all its
// parts, not only the two beside it. Dockview has no event for it, nor a way to name a
// divider's split. So, alone in the GUI (`gui/lint/dock-elements.grit` keeps the rest to
// dockview's API), this reads dockview's elements: its dividers (`dv-sash`) and how its grid
// nests them, as dockview's own `getGridLocation` does. A browser test keeps watch on both
// (`dividers.browser.test.tsx`).

import type { DockviewApi } from "dockview-react";
import { evenOut } from "./splits";

const DIVIDER = "dv-sash";
const GRID = "dv-grid-view"; // what holds the top split
// A split's elements: its node, holding its own splitview's container (`dv-split-view-container`),
// whose views' container (`dv-view-container`) holds a view (`dv-view`) for each part.
const UP_A_PART = 3; // from a part's view to the node of the split it is in

/**
 * The location of the split whose node this is: the indexes of its parts down from the top, as
 * dockview's are; `undefined` where its elements are not nested as dockview's grid nests them.
 */
export function splitLocation(node: Element): number[] | undefined {
  const view = node.parentElement;
  if (view === null) return undefined;
  if (view.classList.contains(GRID)) return [];
  if (!view.classList.contains("dv-view") || view.parentElement === null) return undefined;
  let above: Element | null = view;
  for (let step = 0; step < UP_A_PART && above !== null; step++) above = above.parentElement;
  if (above === null) return undefined;
  const rest = splitLocation(above);
  return rest && [...rest, [...view.parentElement.children].indexOf(view)];
}

/** The split node a divider divides: its splitview's container's parent. */
function dividedNode(divider: Element): Element | null {
  return divider.closest(".dv-split-view-container")?.parentElement ?? null;
}

/** Evens out a split when one of its dividers is double-clicked, until disposed. */
export function evenOutByDoubleClick(api: DockviewApi): { dispose: () => void } {
  const onDoubleClick = (event: MouseEvent) => {
    const divider = event.target instanceof Element ? event.target.closest(`.${DIVIDER}`) : null;
    const node = divider && dividedNode(divider);
    const location = node && splitLocation(node);
    if (location) evenOut(api, location);
  };
  window.addEventListener("dblclick", onDoubleClick);
  return { dispose: () => window.removeEventListener("dblclick", onDoubleClick) };
}
