import type { MouseEvent, TouchEvent } from "react";
import type { ColumnFilterLook } from "./filters";
import styles from "./table.module.css";

/** How a column is laid out, beyond TanStack's sizes: `tableFeatures({ columnMeta: {} as ColumnLook })`. */
export interface ColumnLook {
  width?: string; // a CSS grid track instead of the column's size, for one not resized: a square
  filter?: ColumnFilterLook; // if the list can be filtered by it
  description?: string; // what it shows, if its label doesn't say: in the header's tooltip
  end?: boolean; // its header at its end, over what its cells align there, e.g. numbers
  identifies?: boolean; // says what a row is: never hidden
  second?: boolean; // in two lines, on the second line, quieter
  figures?: boolean; // times or counts: their figures as wide as each other, to line up
}

interface LaidOut {
  id: string;
  getSize: () => number;
  columnDef: { meta?: ColumnLook };
}

/**
 * The `grid-template-columns` for these columns, in order: the widths they ask for, else their
 * sizes; then the room left, blank, so that rows and their header reach across the list, at
 * least their padding at the end. The column `fitting` as wide as its widest cell, to measure it.
 */
export function gridColumns(columns: LaidOut[], fitting?: string): string {
  const widths = columns.map((column) => {
    if (column.id === fitting) return "max-content";
    return column.columnDef.meta?.width ?? `${column.getSize()}px`;
  });
  return [...widths, "minmax(var(--space-3), 1fr)"].join(" ");
}

/**
 * Whether a column is one to arrange: shown or hidden, moved. Those with a header are; those
 * without are a row's fixed parts, such as its square or its links, always in their place.
 */
export function arrangeable(column: { header?: unknown }): boolean {
  return typeof column.header === "string";
}

interface Defined {
  id?: string;
  accessorKey?: unknown;
  header?: unknown;
}

/** A column's ID, as TanStack Table gives it: as set, else its key, else its header. */
function columnId({ id, accessorKey, header }: Defined): string {
  if (id !== undefined) return id;
  if (accessorKey !== undefined) return String(accessorKey).replaceAll(".", "_");
  return typeof header === "string" ? header : "";
}

/**
 * The order of all columns, given in their first order, with those to arrange as `moved`: each
 * takes the place of one of them, in that order; the others stay, as do columns not moved yet.
 */
export function columnsOrdered(columns: readonly Defined[], moved: string[]): string[] {
  const ids = columns.map(columnId);
  const movable = new Set(columns.filter(arrangeable).map(columnId));
  const order = moved.filter((id) => movable.has(id));
  const placed = new Set(order);
  let next = 0;
  return ids.map((id) => (placed.has(id) ? (order[next++] as string) : id));
}

/** The columns to arrange in their order, given in their first order, as `moved`. */
export function arrangedOrder(columns: readonly Defined[], moved: string[]): string[] {
  const movable = new Set(columns.filter(arrangeable).map(columnId));
  return columnsOrdered(columns, moved).filter((id) => movable.has(id));
}

/**
 * The columns to arrange, in `order`, with `id` moved one place to the left (-1) or right (1),
 * past the next column `shown`, or none if no column shows there.
 */
export function movedPast(order: string[], id: string, step: -1 | 1, shown: Set<string>) {
  const from = order.indexOf(id);
  let past = from + step;
  while (past >= 0 && past < order.length && !shown.has(order[past] as string)) past += step;
  const other = order[past];
  if (from < 0 || other === undefined) return undefined;
  return movedBeside(order, id, other, step > 0);
}

/** The columns to arrange, in `order`, with `id` moved just before `other`, or after it. */
export function movedBeside(order: string[], id: string, other: string, after: boolean) {
  const moved = order.filter((each) => each !== id);
  moved.splice(moved.indexOf(other) + (after ? 1 : 0), 0, id);
  return moved;
}

interface ResizerProps {
  header: { getResizeHandler: () => (event: unknown) => void };
  resizing: boolean; // whether it is dragged
  fit: () => void;
}

/** Drag a column's edge to resize it, not its header to move it; a double click fits it. */
export function Resizer({ header, resizing, fit }: ResizerProps) {
  const handler = header.getResizeHandler();
  const resize = (event: MouseEvent | TouchEvent) => {
    if (event.type === "mousedown") event.preventDefault(); // nor drags the header it is in
    handler(event);
  };
  return (
    <hr
      aria-orientation="vertical"
      className={styles.resizer}
      data-resizing={resizing || undefined}
      onMouseDown={resize}
      onTouchStart={resize}
      onDoubleClick={fit}
    />
  );
}
