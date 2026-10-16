// A list's order as the parameter `sort`: a column, after `-` for descending.

import type { SortingState } from "@tanstack/react-table";
import { type Params, paramValues, withParam } from "./address";

/** The order these parameters set: by one of `columns`, else as `fallback` says, e.g. `-active`. */
export function sortingOf(
  params: Params,
  columns: readonly string[],
  fallback: string,
): SortingState {
  const text = paramValues(params.sort)[0] ?? fallback;
  const chosen = columns.includes(text.replace(/^-/, "")) ? text : fallback;
  return [{ id: chosen.replace(/^-/, ""), desc: chosen.startsWith("-") }];
}

/** The parameters with this order; `fallback`'s is left out. */
export function withSorting(params: Params, sorted: SortingState, fallback: string): Params {
  const [first] = sorted;
  const sort = first === undefined ? fallback : `${first.desc ? "-" : ""}${first.id}`;
  return withParam(params, "sort", sort === fallback ? [] : [sort]);
}
