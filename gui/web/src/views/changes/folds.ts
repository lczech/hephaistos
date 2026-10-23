import { type Atom, useAtom } from "@tanstack/react-store";
import { keptAtom } from "../../kept";
import type { Checkout } from "./checkout";

/**
 * What is folded in a Checkout's Views of a kind: paths (files; directories ending in `/`, with
 * all below them) by the part of the View they are in, groups by name; and new folders opened,
 * which are closed unless. A part folds apart from others showing the same paths: each group of
 * Changes, the Diff's stack and its untracked files.
 */
export type Folds = {
  paths: Readonly<Record<string, ReadonlySet<string>>>;
  groups: ReadonlySet<string>;
  opened: ReadonlySet<string>;
};

type Saved = Record<
  string,
  { paths: Record<string, string[]>; groups: string[]; opened: string[] }
>;

const NONE: ReadonlySet<string> = new Set();
const NO_FOLDS: Folds = { paths: {}, groups: NONE, opened: NONE };

/** The paths folded in a part of the View. */
export function partFolded(folds: Folds, part: string): ReadonlySet<string> {
  return folds.paths[part] ?? NONE;
}

/** The folds with a part's paths folded these, the others' as they were. */
export function withPart(folds: Folds, part: string, paths: ReadonlySet<string>): Folds {
  return { ...folds, paths: { ...folds.paths, [part]: paths } };
}

/** Folds of each Checkout's Views of a kind, kept in this browser, until unfolded. */
function keptFolds(kind: "changes" | "diff"): Atom<Saved> {
  return keptAtom(`hephaistos.folds.${kind}`, (saved) => {
    const valid: Saved = {};
    if (typeof saved !== "object" || saved === null) return valid;
    for (const [key, entry] of Object.entries(saved)) {
      const { paths, groups, opened } = (entry ?? {}) as Record<string, unknown>;
      valid[key] = { paths: parts(paths), groups: strings(groups), opened: strings(opened) };
    }
    return valid;
  });
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

/** The paths kept by part; none if kept otherwise. */
function parts(value: unknown): Record<string, string[]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([part, paths]) => [part, strings(paths)]));
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
    ? {
        paths: Object.fromEntries(
          Object.entries(entry.paths).map(([part, paths]) => [part, new Set(paths)]),
        ),
        groups: new Set(entry.groups),
        opened: new Set(entry.opened),
      }
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
  const paths = Object.fromEntries(
    Object.entries(next.paths).flatMap(([part, folded]) =>
      folded.size > 0 ? [[part, [...folded]]] : [],
    ),
  );
  if (Object.keys(paths).length + next.groups.size + next.opened.size === 0) return others;
  return { ...others, [key]: { paths, groups: [...next.groups], opened: [...next.opened] } };
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
