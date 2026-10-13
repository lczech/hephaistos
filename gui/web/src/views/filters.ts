// A list's column filters, kept as its View's parameters.

import type { ColumnFiltersState } from "@tanstack/react-table";
import type { ColumnLook } from "../components/table/columns";
import { type Params, paramValues, withParam } from "./address";

interface Column {
  id?: string;
  meta?: ColumnLook;
}

/** The filters these parameters set, in the columns' order; each one's value is a list. */
export function columnFilters(columns: Column[], params: Params): ColumnFiltersState {
  return columns.flatMap(({ id, meta }) => {
    const values = paramValues(meta?.filter && params[meta.filter.param]);
    return id === undefined || values.length === 0 ? [] : [{ id, value: values }];
  });
}

/** The parameters with only these filters set; those that aren't filters stay. */
export function filteredParams(
  columns: Column[],
  params: Params,
  filters: ColumnFiltersState,
): Params {
  let changed = params;
  for (const { id, meta } of columns) {
    if (meta?.filter === undefined) continue;
    const values = filters.find((filter) => filter.id === id)?.value;
    changed = withParam(changed, meta.filter.param, Array.isArray(values) ? values : []);
  }
  return changed;
}
