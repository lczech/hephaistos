import type { ColumnFilterLook } from "./filters";
import styles from "./table.module.css";

/** How a column is laid out, beyond TanStack's sizes: `tableFeatures({ columnMeta: {} as ColumnLook })`. */
export interface ColumnLook {
  width?: string; // a CSS grid track instead of the column's size, for one not resized: a square
  filter?: ColumnFilterLook; // if the list can be filtered by it
  description?: string; // what it shows, if its label doesn't say: in the header's tooltip
  end?: boolean; // its header at its end, over what its cells align there, e.g. numbers
}

interface LaidOut {
  getSize: () => number;
  columnDef: { meta?: ColumnLook };
}

/**
 * The `grid-template-columns` for these columns, in order: the widths they ask for, else their
 * sizes; then the room left, blank, so that rows and their header reach across the list.
 */
export function gridColumns(columns: LaidOut[]): string {
  const widths = columns.map((column) => column.columnDef.meta?.width ?? `${column.getSize()}px`);
  return [...widths, "minmax(0, 1fr)"].join(" ");
}

interface Resizable {
  getResizeHandler: () => (event: unknown) => void;
  column: { getIsResizing: () => boolean; resetSize: () => void };
}

/** Drag a column's edge to resize it; a double click gives it its first size again. */
export function Resizer({ header }: { header: Resizable }) {
  const resize = header.getResizeHandler();
  return (
    <hr
      aria-orientation="vertical"
      className={styles.resizer}
      data-resizing={header.column.getIsResizing() || undefined}
      onMouseDown={resize}
      onTouchStart={resize}
      onDoubleClick={() => header.column.resetSize()}
    />
  );
}
