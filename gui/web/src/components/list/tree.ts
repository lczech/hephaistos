// What a list's trees share, whatever their rows are: rows within rows that are asked for once
// opened, notes standing in for them, the order of rows beside each other, and what is folded,
// kept in this browser. Paths and folders are `components/files/`'.

import { useAtom } from "@tanstack/react-store";
import type { SortingState } from "@tanstack/react-table";
import { keptAtom } from "../../kept";

/** A row that says something instead of being one: that rows are asked for, why not, or more. */
export type Note = { type: "note"; id: string; text: string; problem?: boolean; subRows: [] };

export function note(id: string, text: string, problem?: boolean): Note {
  return { type: "note", id, text, problem, subRows: [] };
}

/**
 * The ID of a note about a row's rows, `what` it says: apart from any row's, as it has a NUL,
 * which no name has; `:more` would be that of a file named so.
 */
export const noteId = (id: string, what: "loading" | "error" | "more") => `${id}\0${what}`;

/** What a row opened holds, once asked for: some of its items, of how many; or why not. */
export type Loaded<T> = { items: T[]; count: number } | { error: string } | undefined;

/** What the notes standing in for a row's items say: how many more, and while asked for. */
export interface NoteTexts {
  more: (more: number, listed: number) => string;
  loading?: string; // `Loading files…`; else `Loading…`
}

/**
 * The rows within a row opened (`id`): its items' rows, then a note of how many more there are
 * than listed; or, while they are asked for or if they cannot be, a note saying so.
 */
export function loadedRows<T, R>(
  id: string,
  loaded: Loaded<T>,
  rows: (items: T[]) => R[],
  texts: NoteTexts,
): (R | Note)[] {
  if (loaded === undefined) return [note(noteId(id, "loading"), texts.loading ?? "Loading…")];
  if ("error" in loaded)
    return [note(noteId(id, "error"), `Could not load: ${loaded.error}`, true)];
  const shown: (R | Note)[] = rows(loaded.items);
  const left = loaded.count - loaded.items.length;
  if (left > 0) shown.push(note(noteId(id, "more"), texts.more(left, loaded.items.length)));
  return shown;
}

/**
 * How rows beside each other are ordered: those of a lower `rank` first, whatever the order
 * chosen, e.g. folders before files; then by the column sorted by, its values by `values`, those
 * without one last either way; ties, and an order not chosen, by the `fallback` column. Texts
 * compare by their characters' codes, or as `collator` compares them, e.g. as people sort names.
 */
export interface Order<T> {
  rank?: (row: T) => number;
  values: Record<string, (row: T) => string | number | undefined>;
  fallback: string;
  collator?: Intl.Collator;
}

/** Rows beside each other, in the `order` sorted by: TanStack's sorting state of a list. */
export function inOrder<T>(rows: T[], sorted: SortingState, order: Order<T>): T[] {
  const [{ id, desc } = { id: order.fallback, desc: false }] = sorted;
  const value = order.values[id] ?? order.values[order.fallback];
  const fallback = order.values[order.fallback];
  const rank = order.rank ?? (() => 0);
  const compare = comparing(order.collator);
  const sign = desc ? -1 : 1;
  return [...rows].sort((a, b) => {
    const ranked = rank(a) - rank(b);
    if (ranked !== 0) return ranked;
    const [x, y] = [value?.(a), value?.(b)];
    if (x !== undefined && y !== undefined) {
      const compared = compare(x, y);
      if (compared !== 0) return sign * compared;
    } else if (x !== y) {
      return compare(x, y); // unknown last, either way
    }
    return id === order.fallback ? 0 : compare(fallback?.(a), fallback?.(b));
  });
}

type Value = string | number | undefined;

/** How two values compare: unknown last; texts by `collator`, if given. */
function comparing(collator: Intl.Collator | undefined): (x: Value, y: Value) => number {
  return (x, y) => {
    if (x === y) return 0;
    if (x === undefined) return 1;
    if (y === undefined) return -1;
    if (collator && typeof x === "string" && typeof y === "string") return collator.compare(x, y);
    return x < y ? -1 : 1;
  };
}

/** Named sets of row IDs, e.g. those folded and those opened. */
export type Sets = Readonly<Record<string, ReadonlySet<string>>>;

type Saved = Record<string, Record<string, string[]>>;

/** Sets of row IDs kept in this browser under `hephaistos.folds.<name>`, by a key each. */
function keptSets(name: string) {
  return keptAtom(`hephaistos.folds.${name}`, (saved): Saved => {
    const valid: Saved = {};
    if (typeof saved !== "object" || saved === null) return valid;
    for (const [key, sets] of Object.entries(saved)) {
      if (typeof sets !== "object" || sets === null || Array.isArray(sets)) continue;
      valid[key] = Object.fromEntries(
        Object.entries(sets).map(([set, ids]) => [
          set,
          Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [],
        ]),
      );
    }
    return valid;
  });
}

const NO_SETS: Sets = {};

/**
 * What is folded or opened in a tree, as sets of row IDs, kept in this browser (`name`) for
 * what the tree shows (`key`), e.g. a Checkout: shared by all its trees of that name, until
 * changed. Without a key, none, and none kept.
 */
export function useKeptSets(name: string, key: string | undefined): [Sets, (next: Sets) => void] {
  const [saved, setSaved] = useAtom(keptSets(name));
  const entry = key === undefined ? undefined : saved[key];
  const sets = entry
    ? Object.fromEntries(Object.entries(entry).map(([set, ids]) => [set, new Set(ids)]))
    : NO_SETS;
  const setSets = (next: Sets) => {
    if (key !== undefined) setSaved((saved) => savedWith(saved, key, next));
  };
  return [sets, setSets];
}

/** What is kept, with a key's sets; empty ones left out, and the key if all are. */
function savedWith(saved: Saved, key: string, next: Sets): Saved {
  const { [key]: _, ...others } = saved;
  const kept = Object.entries(next).flatMap(([set, ids]) =>
    ids.size > 0 ? [[set, [...ids]] as [string, string[]]] : [],
  );
  return kept.length > 0 ? { ...others, [key]: Object.fromEntries(kept) } : others;
}
