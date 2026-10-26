import type { ColumnFiltersState, ReactTable, RowData, SortingState } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, Funnel, FunnelX } from "lucide-react";
import { Picker } from "../Picker";
import { DIRECTIONS } from "./ColumnHeader";
import { Filter, offeredFilter } from "./Filter";
import { type Choice, filterText } from "./filters";
import type { ListFeatures } from "./list";
import styles from "./table.module.css";

const NO_VALUES: string[] = [];

interface Props<TData extends RowData> {
  table: ReactTable<ListFeatures, TData>;
  filters: ColumnFiltersState; // as set: what changes comes as props, for React's compiler to see
  sorting: SortingState;
  choices: Record<string, Choice[] | undefined>; // each filtering column's
}

/**
 * A list's header in two lines, where the View places the cells: a button for each filter,
 * saying what it is set to and opening its choices; one clearing them all while any is set; at
 * the end, the column the list is sorted by, opening the others, and its direction, turning it.
 */
export function LinesHead<TData extends RowData>({
  table,
  filters,
  sorting,
  choices,
}: Props<TData>) {
  const columns = table.getAllLeafColumns();
  const [sorted] = sorting;
  return (
    <>
      {columns.map((column) => {
        const values =
          (filters.find(({ id }) => id === column.id)?.value as string[] | undefined) ?? NO_VALUES;
        const look = offeredFilter(column.columnDef.meta?.filter, values);
        if (look === undefined) return null;
        const offered = choices[column.id] ?? [];
        const text = values.length > 0 ? filterText(values, offered, look.many) : undefined;
        return (
          <Filter
            key={column.id}
            name={column.id}
            look={look}
            values={values}
            choices={offered}
            set={(chosen) => column.setFilterValue(chosen.length ? chosen : undefined)}
          >
            <button
              type="button"
              className={styles.pick}
              data-filtered={text !== undefined || undefined}
              title={`Filter by ${column.id}`}
            >
              <Funnel className={styles.pickIcon} aria-hidden="true" />
              {column.id}
              {text !== undefined && `: ${text}`}
            </button>
          </Filter>
        );
      })}
      {filters.length > 0 && (
        <button
          type="button"
          className={styles.pick}
          data-clear
          aria-label="Clear all filters"
          title="Clear all filters"
          onClick={() => table.resetColumnFilters(true)}
        >
          <FunnelX className={styles.pickIcon} aria-hidden="true" />
        </button>
      )}
      {sorted !== undefined && <Sorting table={table} sorted={sorted} />}
    </>
  );
}

interface SortingProps<TData extends RowData> {
  table: ReactTable<ListFeatures, TData>;
  sorted: SortingState[number];
}

/** The column sorted by, its button opening the others, each first sorted as its header would. */
function Sorting<TData extends RowData>({ table, sorted }: SortingProps<TData>) {
  const sortable = table.getAllLeafColumns().filter((column) => column.getCanSort());
  const name = (id: string) => {
    const header = table.getColumn(id)?.columnDef.header;
    return typeof header === "string" ? header : id;
  };
  const [now, other] = sorted.desc ? (["desc", "asc"] as const) : (["asc", "desc"] as const);
  const Arrow = sorted.desc ? ArrowDown : ArrowUp;
  return (
    <span className={styles.sorting}>
      <Picker
        label="Sort by"
        title="Sort by another column"
        picks={sortable.map(({ id }) => ({ id, text: name(id) }))}
        picked={sorted.id}
        onPick={(id) => {
          const column = table.getColumn(id);
          column?.toggleSorting(column.getFirstSortDir() === "desc");
        }}
        placement="bottom end"
      >
        sorted by {name(sorted.id)}
      </Picker>
      <button
        type="button"
        className={styles.pick}
        aria-label={`Sort ${DIRECTIONS[other]}`}
        title={`Sorted ${DIRECTIONS[now]}; click to sort ${DIRECTIONS[other]}`}
        onClick={() => table.getColumn(sorted.id)?.toggleSorting(!sorted.desc)}
      >
        <Arrow className={styles.pickIcon} aria-hidden="true" />
      </button>
    </span>
  );
}
