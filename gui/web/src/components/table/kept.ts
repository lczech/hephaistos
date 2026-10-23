// What a list keeps in this browser, per kind of View (`hephaistos.lists.<kind>.<part>`): shared
// by its Panels, whatever they show, and not part of addresses.

import { type Atom, useAtom } from "@tanstack/react-store";
import type { ColumnSizingState } from "@tanstack/react-table";
import { keptAtom } from "../../kept";

/** How a list shows its rows: in columns, or each row in two lines, as for narrow Panels. */
export type ListLayout = "columns" | "lines";

/** The column widths of a kind of View's list. */
export function columnWidths(kind: string): Atom<ColumnSizingState> {
  return keptAtom(`hephaistos.lists.${kind}.widths`, widths);
}

function widths(saved: unknown): ColumnSizingState {
  if (typeof saved !== "object" || saved === null) return {};
  return Object.fromEntries(
    Object.entries(saved).filter(([, width]) => Number.isFinite(width)),
  ) as ColumnSizingState;
}

function layoutChosen(kind: string): Atom<ListLayout | null> {
  return keptAtom(`hephaistos.lists.${kind}.layout`, (saved) =>
    saved === "columns" || saved === "lines" ? saved : null,
  );
}

/** The layout this device starts with: two lines where the main pointer is a finger. */
function deviceLayout(): ListLayout {
  return globalThis.matchMedia?.("(pointer: coarse)").matches ? "lines" : "columns";
}

/** A kind of View's list layout, as chosen, else as the device starts with; and how to choose. */
export function useListLayout(kind: string): [ListLayout, (layout: ListLayout) => void] {
  const [chosen, setChosen] = useAtom(layoutChosen(kind));
  return [chosen ?? deviceLayout(), setChosen];
}
