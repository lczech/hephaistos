import { type Atom, useAtom } from "@tanstack/react-store";
import { keptAtom } from "../../kept";
import type { Checkout } from "./checkout";

/**
 * What is folded in a Checkout's Views of a kind: paths (files; directories ending in `/`, with
 * all below them), groups by name; and new folders opened, which are closed unless.
 */
export type Folds = {
  paths: ReadonlySet<string>;
  groups: ReadonlySet<string>;
  opened: ReadonlySet<string>;
};

type Saved = Record<string, { paths: string[]; groups: string[]; opened: string[] }>;

const NONE: ReadonlySet<string> = new Set();
const NO_FOLDS: Folds = { paths: NONE, groups: NONE, opened: NONE };

/** Folds of each Checkout's Views of a kind, kept in this browser, until unfolded. */
function keptFolds(kind: "changes" | "diff"): Atom<Saved> {
  return keptAtom(`hephaistos.folds.${kind}`, (saved) => {
    const valid: Saved = {};
    if (typeof saved !== "object" || saved === null) return valid;
    for (const [key, entry] of Object.entries(saved)) {
      const { paths, groups, opened } = (entry ?? {}) as Record<string, unknown>;
      valid[key] = { paths: strings(paths), groups: strings(groups), opened: strings(opened) };
    }
    return valid;
  });
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function checkoutKey(checkout: Checkout): string {
  return "clone" in checkout ? `clone:${checkout.clone}` : `worktree:${checkout.worktree}`;
}

/**
 * The folds of a Checkout's Changes or Diff Views, shared by them all, in every comparison:
 * what is folded stays so until unfolded. Without a Checkout, none, and none kept.
 */
export function useFolds(
  kind: "changes" | "diff",
  checkout: Checkout | undefined,
): [Folds, (next: Folds) => void] {
  const [saved, setSaved] = useAtom(keptFolds(kind));
  const key = checkout && checkoutKey(checkout);
  const entry = key === undefined ? undefined : saved[key];
  const folds = entry
    ? { paths: new Set(entry.paths), groups: new Set(entry.groups), opened: new Set(entry.opened) }
    : NO_FOLDS;
  const setFolds = (next: Folds) => {
    if (key === undefined) return;
    setSaved((saved) => savedWith(saved, key, next));
  };
  return [folds, setFolds];
}

/** What is kept, with a Checkout's folds; none left out. */
function savedWith(saved: Saved, key: string, next: Folds): Saved {
  const { [key]: _, ...others } = saved;
  if (next.paths.size + next.groups.size + next.opened.size === 0) return others;
  const kept = { paths: [...next.paths], groups: [...next.groups], opened: [...next.opened] };
  return { ...others, [key]: kept };
}

/**
 * The folded path that folds `path`: the outermost directory above it folded, else itself if
 * folded; undefined if none is. A directory's header can read otherwise elsewhere (a chain
 * joined, or each by its path), so a fold holds for all below it.
 */
export function foldedBy(paths: ReadonlySet<string>, path: string): string | undefined {
  for (let cut = path.indexOf("/"); cut !== -1 && cut < path.length - 1; ) {
    const above = path.slice(0, cut + 1);
    if (paths.has(above)) return above;
    cut = path.indexOf("/", cut + 1);
  }
  return paths.has(path) ? path : undefined;
}

/** The paths with `path` folded, or unfolded: with whatever folded it above, so it shows. */
export function withFolded(
  paths: ReadonlySet<string>,
  path: string,
  folded: boolean,
): ReadonlySet<string> {
  return folded ? new Set([...paths, path]) : unfolding(paths, [path]);
}

/** The paths without any that folds one of `shown`: each itself, or a directory above it. */
export function unfolding(
  paths: ReadonlySet<string>,
  shown: Iterable<string>,
): ReadonlySet<string> {
  const next = new Set(paths);
  for (const path of shown) {
    for (let by = foldedBy(next, path); by !== undefined; by = foldedBy(next, path)) {
      next.delete(by);
    }
  }
  return next;
}
