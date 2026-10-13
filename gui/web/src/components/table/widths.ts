import { type Atom, createAtom } from "@tanstack/react-store";
import type { ColumnSizingState } from "@tanstack/react-table";

const kept = new Map<string, Atom<ColumnSizingState>>();

/** The column widths of a kind of View: shared by its Panels, whatever they show, and kept in this browser. */
export function columnWidths(kind: string): Atom<ColumnSizingState> {
  let widths = kept.get(kind);
  if (widths === undefined) {
    const key = `hephaistos.columns.${kind}`;
    widths = createAtom(read(key));
    widths.subscribe((changed) => write(key, changed));
    kept.set(kind, widths);
  }
  return widths;
}

function read(key: string): ColumnSizingState {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
    if (typeof saved !== "object" || saved === null) return {};
    return Object.fromEntries(
      Object.entries(saved).filter(([, width]) => Number.isFinite(width)),
    ) as ColumnSizingState;
  } catch {
    return {}; // unreadable, or no storage
  }
}

function write(key: string, widths: ColumnSizingState): void {
  try {
    localStorage.setItem(key, JSON.stringify(widths));
  } catch {
    // no storage: the widths last as long as the page
  }
}
