import type { ColumnFilterLook } from "./filters";
import styles from "./table.module.css";

/** How a column is laid out, beyond TanStack's sizes: `tableFeatures({ columnMeta: {} as ColumnLook })`. */
export interface ColumnLook {
  width?: string; // a CSS grid track instead of the column's size, e.g. one taking the rest
  filter?: ColumnFilterLook; // if the list can be filtered by it
  description?: string; // what it shows, if its label doesn't say: in the header's tooltip
  end?: boolean; // its header at its end, over what its cells align there, e.g. numbers
}

interface LaidOut {
  getSize: () => number;
  columnDef: { minSize?: number; meta?: ColumnLook };
}

/**
 * The `grid-template-columns` for these columns, in order: the widths they ask for, or their sizes,
 * which give way down to their minimum before a column taking the rest goes below its own.
 */
export function gridColumns(columns: LaidOut[]): string {
  return columns
    .map((column) => {
      const { minSize = 0, meta } = column.columnDef;
      return meta?.width ?? `minmax(${minSize}px, ${column.getSize()}px)`;
    })
    .join(" ");
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
