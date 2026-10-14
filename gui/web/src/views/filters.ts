// A list's column filters, kept as its View's parameters.

import type { ColumnFiltersState } from "@tanstack/react-table";
import type { ColumnLook } from "../components/table/columns";
import { type Choice, filterText } from "../components/table/filters";
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

/** What a column filtering by time offers: as `--since` takes them. */
export const SINCE: Choice[] = [
  { value: "1h", label: "last hour" },
  { value: "1d", label: "last day" },
  { value: "7d", label: "last week" },
];

const NAMED = 2; // more filters than this are only counted

/**
 * The tab's title for these filters: `Events: last day, project`. Nothing while the choices
 * of one are still asked for, so that a name never shows as an ID first.
 */
export function filteredTitle(
  name: string,
  columns: Column[],
  filters: ColumnFiltersState,
  choices: Record<string, Choice[] | undefined>,
): string | undefined {
  if (filters.length === 0) return name;
  if (filters.length > NAMED) return `${name}: ${filters.length} filters`;
  const texts: string[] = [];
  for (const { id, value } of filters) {
    const offered = choices[id];
    if (offered === undefined) return undefined;
    const many = columns.find((column) => column.id === id)?.meta?.filter?.many;
    texts.push(filterText(value as string[], offered, many));
  }
  return `${name}: ${texts.join(", ")}`;
}
