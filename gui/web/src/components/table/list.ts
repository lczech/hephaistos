// What the GUI's lists share: TanStack Table's features and defaults, bound once.

import {
  columnFilteringFeature,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createTableHook,
  tableFeatures,
} from "@tanstack/react-table";
import type { ColumnLook } from "./columns";

/** What a list's cells may need besides their row. */
export interface ListMeta {
  now: number; // for times as `5m ago`
  home?: string; // for paths as `~/…`
}

export const listFeatures = tableFeatures({
  columnFilteringFeature,
  columnVisibilityFeature,
  columnSizingFeature,
  columnResizingFeature,
  columnMeta: {} as ColumnLook,
  tableMeta: {} as ListMeta,
});

export type ListFeatures = typeof listFeatures;

export const { useAppTable: useListTable, createAppColumnHelper: listColumnHelper } =
  createTableHook({
    features: listFeatures,
    // Every column can be made as narrow as this, and gives way to it before one taking the rest.
    defaultColumn: { minSize: 40 },
    columnResizeMode: "onChange",
  });
