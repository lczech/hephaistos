// What the GUI's lists share: TanStack Table's features and defaults, bound once.

import { useAtom } from "@tanstack/react-store";
import {
  columnFilteringFeature,
  columnOrderingFeature,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createExpandedRowModel,
  createSortedRowModel,
  createTableHook,
  type RowData,
  rowExpandingFeature,
  rowSortingFeature,
  sortFn_basic,
  sortFn_text,
  type TableOptions,
  tableFeatures,
} from "@tanstack/react-table";
import { type ColumnLook, columnsOrdered } from "./columns";
import { columnOrder, columnWidths, hiddenColumns, hiddenOf, type ListLayout } from "./kept";

/** What a list's cells may need besides their row; and how its look is kept. */
export interface ListMeta {
  now?: number; // for times as `5m ago`
  home?: string; // for paths as `~/…`
  kind?: string; // its look's, as kept: `hephaistos.lists.<kind>`
}

export const listFeatures = tableFeatures({
  columnFilteringFeature,
  columnVisibilityFeature,
  columnOrderingFeature,
  columnSizingFeature,
  columnResizingFeature,
  rowSortingFeature, // by the columns that allow it
  rowExpandingFeature, // rows within rows
  sortedRowModel: createSortedRowModel(),
  expandedRowModel: createExpandedRowModel(),
  sortFns: { basic: sortFn_basic, text: sortFn_text },
  columnMeta: {} as ColumnLook,
  tableMeta: {} as ListMeta,
});

export type ListFeatures = typeof listFeatures;

const { useAppTable, createAppColumnHelper } = createTableHook({
  features: listFeatures,
  defaultColumn: { minSize: 40, enableSorting: false }, // every column can be made this narrow
  columnResizeMode: "onChange",
});

export const listColumnHelper = createAppColumnHelper;

type ListOptions<TData extends RowData> = Omit<TableOptions<ListFeatures, TData>, "features">;

/**
 * A list's table, set up as kept for its kind of View (`kind`, see `kept.ts`): its columns'
 * widths; in columns, also which are hidden and their order. A column filtered or sorted by
 * shows, even if hidden.
 */
export function useList<TData extends RowData>(
  kind: string,
  layout: ListLayout,
  options: ListOptions<TData>,
) {
  const hidden = useHidden(kind, layout, options.columns, options.state);
  const [moved] = useAtom(columnOrder(kind));
  const inColumns = layout === "columns";
  return useAppTable({
    ...options,
    atoms: { columnSizing: columnWidths(kind) },
    state: {
      ...options.state,
      columnVisibility: Object.fromEntries([...hidden].map((id) => [id, false])),
      columnOrder: inColumns ? columnsOrdered(options.columns, moved) : [],
    },
    meta: { ...options.meta, kind },
  });
}

/**
 * The columns a kind of View's list hides, by their IDs: as kept, else those hidden until shown;
 * in columns only. A column filtered or sorted by shows, even if hidden. Also for a View to ask
 * only for what its shown columns need.
 */
export function useHidden(
  kind: string,
  layout: ListLayout,
  columns: readonly { id?: string; meta?: { hiddenAtFirst?: boolean } }[],
  state?: { columnFilters?: { id: string }[]; sorting?: { id: string }[] },
): ReadonlySet<string> {
  const [kept] = useAtom(hiddenColumns(kind));
  const { columnFilters = [], sorting = [] } = state ?? {};
  const shown = new Set([...columnFilters, ...sorting].map(({ id }) => id));
  if (layout !== "columns") return new Set();
  return new Set(hiddenOf(kept, columns).filter((id) => !shown.has(id)));
}
