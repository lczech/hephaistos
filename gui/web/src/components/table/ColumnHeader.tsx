import { ArrowDown, ArrowUp, Funnel } from "lucide-react";
import { type ReactNode, useRef } from "react";
import { useDrag } from "react-aria-components";
import { type ColumnLook, Resizer } from "./columns";
import { Filter, offeredFilter } from "./Filter";
import { type Choice, filterText } from "./filters";
import styles from "./table.module.css";

/**
 * What TanStack Table's headers offer, of a list with column filtering, sizing and resizing. The
 * same objects whatever changes, so what changes comes as props, for React's compiler to see.
 */
interface Header {
  column: {
    id: string;
    columnDef: { meta?: ColumnLook };
    setFilterValue: (value: string[] | undefined) => void;
    getCanResize: () => boolean;
    getCanSort: () => boolean;
    getToggleSortingHandler: () => undefined | ((event: unknown) => void);
  };
  getResizeHandler: () => (event: unknown) => void;
}

interface Props {
  header: Header;
  sorted: false | "asc" | "desc"; // whether the list is sorted by it, and how
  values: string[]; // what its filter is set to; none for all
  resizing: boolean; // whether its edge is dragged
  moves?: string; // what dragging it carries (`COLUMN_DRAG`), if it can be dragged elsewhere
  choices?: Choice[]; // what its filter offers; none while they load
  onFit: (header: HTMLElement) => void; // fits the column to its cells
  children?: ReactNode; // the column's label
}

/** What a header dragged carries: its list's kind and its column, as JSON. */
export const COLUMN_DRAG = "application/x-hephaistos-column";

/**
 * A column's header: its label, saying what its filter is set to, which sorts by the column if it
 * can; at its end a funnel opening the filter's choices, if it has one; its edge resizes it.
 * Dragged, it moves the column, if it may.
 */
export function ColumnHeader({
  header,
  sorted,
  values,
  resizing,
  moves,
  choices = [],
  onFit,
  children,
}: Props) {
  const { column } = header;
  const own = useRef<HTMLSpanElement>(null);
  // By the mouse only: the keys and screen readers move it by the header's menu; React Aria's
  // way for them would start a drag on a screen reader's click, taking it from the sort button.
  const { dragProps, isDragging } = useDrag({
    getItems: () => [{ [COLUMN_DRAG]: moves ?? "" }],
    getAllowedDropOperations: () => ["move"],
    isDisabled: moves === undefined,
    hasDragButton: true,
  });
  const filter = offeredFilter(column.columnDef.meta?.filter, values);
  const set = (chosen: string[]) => column.setFilterValue(chosen.length ? chosen : undefined);
  const text = values.length > 0 ? filterText(values, choices, filter?.many) : undefined;
  const description = column.columnDef.meta?.description;
  return (
    <span
      {...dragProps}
      ref={own}
      className={styles.header}
      data-dragging={isDragging || undefined}
      data-column={column.id}
      data-end={column.columnDef.meta?.end || undefined}
      data-filterable={filter !== undefined || undefined}
      data-sortable={column.getCanSort() || undefined}
      data-filtered={text !== undefined || undefined}
    >
      {children !== undefined &&
        (column.getCanSort() ? (
          <SortButton column={column} sorted={sorted} description={description}>
            {children}
          </SortButton>
        ) : (
          <span className={styles.label} title={lines(description, text)}>
            {children}
            {text !== undefined && `: ${text}`}
          </span>
        ))}
      {filter !== undefined && (
        <Filter
          name={column.id}
          look={filter}
          values={values}
          choices={choices}
          set={set}
          anchor={own} // below the whole header, lined up with its column
        >
          <button
            type="button"
            className={styles.filter}
            aria-label={`Filter by ${column.id}`}
            title={text === undefined ? `Filter by ${column.id}` : `${column.id}: ${text}`}
          >
            <Funnel aria-hidden="true" />
          </button>
        </Filter>
      )}
      {column.getCanResize() && (
        <Resizer
          header={header}
          resizing={resizing}
          fit={() => own.current && onFit(own.current)}
        />
      )}
    </span>
  );
}

export const DIRECTIONS = { asc: "ascending", desc: "descending" };

/** A tooltip of these lines, leaving out those missing; none without any. */
function lines(...texts: (string | undefined)[]): string | undefined {
  return texts.filter(Boolean).join("\n") || undefined;
}

interface SortProps {
  column: Header["column"];
  sorted: Props["sorted"];
  description: string | undefined;
  children: ReactNode;
}

/** A column's label that sorts by it, or the other way round once it does. */
function SortButton({ column, sorted, description, children }: SortProps) {
  const Arrow = sorted === "desc" ? ArrowDown : ArrowUp;
  return (
    <button
      type="button"
      className={`${styles.label} ${styles.sort}`}
      onClick={column.getToggleSortingHandler()}
      title={lines(
        description,
        sorted ? `Sorted by ${column.id}, ${DIRECTIONS[sorted]}` : `Sort by ${column.id}`,
      )}
    >
      {children}
      {sorted && <Arrow aria-hidden="true" />}
    </button>
  );
}
