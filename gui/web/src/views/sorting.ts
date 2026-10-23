// A list's order, as the `sort` of its address's fragment (how the list is looked at): a column,
// after `-` for descending.

import type { SortingState } from "@tanstack/react-table";
import { type Params, paramValues, withParam } from "./address";

/** The order a fragment sets: by one of `columns`, else as `fallback` says, e.g. `-active`. */
export function sortingOf(
  fragment: Params,
  columns: readonly string[],
  fallback: string,
): SortingState {
  const text = paramValues(fragment.sort)[0] ?? fallback;
  const chosen = columns.includes(text.replace(/^-/, "")) ? text : fallback;
  return [{ id: chosen.replace(/^-/, ""), desc: chosen.startsWith("-") }];
}

/** The fragment with this order; `fallback`'s is left out. */
export function withSorting(fragment: Params, sorted: SortingState, fallback: string): Params {
  const [first] = sorted;
  const sort = first === undefined ? fallback : `${first.desc ? "-" : ""}${first.id}`;
  return withParam(fragment, "sort", sort === fallback ? [] : [sort]);
}
