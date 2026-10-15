// The Repositories list's rows: each Repository, its Clones within it, their Worktrees within
// those; and how a Checkout's State reads.

import type { SortingState } from "@tanstack/react-table";
import type { Schemas } from "../../api/client";
import type { Tone } from "../../components/table/ListTable";
import { shortPath } from "../../paths";
import { type Params, paramValues, withParam } from "../address";

export type Repository = Schemas["RepositoryJson"];
export type Clone = Schemas["CloneJson"];
export type Worktree = Schemas["WorktreeJson"];
export type Checkout = Clone | Worktree;

/** A row: a Repository, a Clone or a Worktree, with the rows within it. */
export type Entry =
  | { type: "repository"; repository: Repository; subRows: Entry[] }
  | { type: "clone"; repository: Repository; clone: Clone; subRows: Entry[] }
  | { type: "worktree"; repository: Repository; clone: Clone; worktree: Worktree; subRows: [] };

export function entries(repositories: Repository[]): Entry[] {
  return repositories.map((repository) => ({
    type: "repository",
    repository,
    subRows: repository.clones.map((clone) => ({
      type: "clone",
      repository,
      clone,
      subRows: clone.worktrees.map((worktree) => ({
        type: "worktree",
        repository,
        clone,
        worktree,
        subRows: [],
      })),
    })),
  }));
}

/** What the row is about, by its ID, unique among all rows. */
export function entryId(entry: Entry): string {
  return `${entry.type}:${checkout(entry)?.id ?? entry.repository.id}`;
}

export function checkout(entry: Entry): Checkout | undefined {
  if (entry.type === "clone") return entry.clone;
  if (entry.type === "worktree") return entry.worktree;
  return undefined;
}

/** A Worktree's path within its Clone, as `.worktrees/feature`; else in full. */
export function worktreePath(worktree: Worktree, clone: Clone, home: string | undefined): string {
  for (const top of [clone.path, clone.resolved_path]) {
    if (worktree.path.startsWith(`${top}/`)) return worktree.path.slice(top.length + 1);
  }
  return shortPath(worktree.path, home);
}

/** A row's name: the Repository's, the Clone's path, the Worktree's within its Clone. */
export function nameText(entry: Entry, home: string | undefined): string {
  if (entry.type === "clone") return shortPath(entry.clone.path, home);
  if (entry.type === "worktree") return worktreePath(entry.worktree, entry.clone, home);
  return entry.repository.name;
}

/** A Checkout's path in full, and what it resolves to if not itself; nothing for a Repository. */
export function nameTitle(entry: Entry): string | undefined {
  if (entry.type === "worktree") return entry.worktree.path;
  if (entry.type !== "clone") return undefined;
  const { path, resolved_path } = entry.clone;
  return resolved_path === path ? path : `${path}\nresolves to ${resolved_path}`;
}

/** What the name column sorts by: the name, or the path. */
export function nameKey(entry: Entry): string {
  return checkout(entry)?.path ?? entry.repository.name;
}

/** When HEAD last moved, in the Checkout or any of the Repository's; null if unknown. */
export function activeAt(entry: Entry): string | null {
  return (checkout(entry) ?? entry.repository).active_at;
}

export function branchText(state: Checkout): string {
  return state.branch ?? "(detached)";
}

/** The status as the CLI's lists show it: `clean`, `+2 ~3 ?1 !1 ↑1 ↓2`, or a condition. */
/** The branch and what it tracks, or the commit a detached HEAD is at. */
export function branchTitle(state: Checkout): string {
  if (state.branch === null) {
    return state.head === null ? "detached" : `detached at ${state.head.slice(0, 7)}`;
  }
  return `${state.branch}, ${state.upstream === null ? "no upstream" : `tracking ${state.upstream}`}`;
}

export function statusText(state: Checkout): string {
  if (!state.present) return "missing";
  if (state.error !== null) return "failed";
  if (state.staged === null) return "bare";
  const counts: [string, number | null][] = [
    ["+", state.staged],
    ["~", state.changed],
    ["?", state.untracked],
    ["!", state.conflicted],
    ["↑", state.ahead],
    ["↓", state.behind],
  ];
  return (
    counts
      .filter(([, count]) => count)
      .map(([symbol, count]) => `${symbol}${count}`)
      .join(" ") || "clean"
  );
}

/** The status spelled out: `3 changed, 1 untracked; 1 ahead of origin/main`. */
export function statusTitle(state: Checkout): string {
  if (!state.present) return "missing: not at its path when last observed";
  if (state.error !== null) return `failed: ${state.error}`;
  if (state.staged === null) return "bare: no working tree";
  const changes = (
    [
      [state.staged, "staged"],
      [state.changed, "changed"],
      [state.untracked, "untracked"],
      [state.conflicted, "conflicted"],
    ] as const
  )
    .filter(([count]) => count)
    .map(([count, what]) => `${count} ${what}`);
  const { upstream, ahead, behind } = state;
  let tracking = "no upstream";
  if (upstream !== null) {
    const moved = [ahead ? `${ahead} ahead of` : "", behind ? `${behind} behind` : ""];
    const text = moved.filter(Boolean).join(" and ");
    tracking = text ? `${text} ${upstream}` : `up to date with ${upstream}`;
  }
  return `${changes.join(", ") || "no changes"}; ${tracking}`;
}

/** A Checkout's row: red with conflicts, amber when missing or failed, quiet when bare. */
export function tone(entry: Entry): Tone | undefined {
  const state = checkout(entry);
  if (state === undefined) return undefined;
  if (state.conflicted) return "danger";
  if (!state.present || state.error !== null) return "warning";
  if (state.staged === null) return "muted";
  return undefined;
}

// The order, as the parameter `sort`: a column, after `-` for descending; newest first if none.
const DEFAULT_SORT = "-active";
const SORTED = /^(-?)(name|active)$/;

/** The order these parameters set. */
export function sorting(params: Params): SortingState {
  const [, minus, id = "active"] = SORTED.exec(paramValues(params.sort)[0] ?? DEFAULT_SORT) ?? [];
  return [{ id, desc: minus === "-" || minus === undefined }];
}

/** The parameters with this order; the default one is left out. */
export function sortParams(params: Params, sorted: SortingState): Params {
  const [first] = sorted;
  const sort = first === undefined ? DEFAULT_SORT : `${first.desc ? "-" : ""}${first.id}`;
  return withParam(params, "sort", sort === DEFAULT_SORT ? [] : [sort]);
}
