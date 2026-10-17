import type { Atom } from "@tanstack/react-store";
import type { ColumnSizingState } from "@tanstack/react-table";
import { keptAtom } from "../../kept";

/** The column widths of a kind of View: shared by its Panels, whatever they show, and kept in this browser. */
export function columnWidths(kind: string): Atom<ColumnSizingState> {
  return keptAtom(`hephaistos.columns.${kind}`, widths);
}

function widths(saved: unknown): ColumnSizingState {
  if (typeof saved !== "object" || saved === null) return {};
  return Object.fromEntries(
    Object.entries(saved).filter(([, width]) => Number.isFinite(width)),
  ) as ColumnSizingState;
}
