import { useKeptSets } from "../../components/list/tree";
import type { Checkout } from "../checkout";

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

const NONE: ReadonlySet<string> = new Set();

/** The paths folded in a part of the View. */
export function partFolded(folds: Folds, part: string): ReadonlySet<string> {
  return folds.paths[part] ?? NONE;
}

/** The folds with a part's paths folded these, the others' as they were. */
export function withPart(folds: Folds, part: string, paths: ReadonlySet<string>): Folds {
  return { ...folds, paths: { ...folds.paths, [part]: paths } };
}

function checkoutKey(checkout: Checkout): string {
  return "clone" in checkout ? `clone:${checkout.clone}` : `worktree:${checkout.worktree}`;
}

// The kept sets' names: groups and new folders opened by theirs, a part's paths by the part's.
const GROUPS = "groups";
const OPENED = "opened";
const PART = "paths:";

/**
 * The folds of a Checkout's Changes or Diff Views, shared by them all, in every comparison:
 * what is folded stays so until unfolded. Without a Checkout, none, and none kept.
 */
export function useFolds(
  kind: "changes" | "diff",
  checkout: Checkout | undefined,
): [Folds, (next: Folds) => void] {
  const [sets, setSets] = useKeptSets(kind, checkout && checkoutKey(checkout));
  const paths = Object.fromEntries(
    Object.entries(sets).flatMap(([name, set]) =>
      name.startsWith(PART) ? [[name.slice(PART.length), set]] : [],
    ),
  );
  const folds = { paths, groups: sets[GROUPS] ?? NONE, opened: sets[OPENED] ?? NONE };
  const setFolds = (next: Folds) =>
    setSets({
      ...Object.fromEntries(Object.entries(next.paths).map(([part, set]) => [PART + part, set])),
      [GROUPS]: next.groups,
      [OPENED]: next.opened,
    });
  return [folds, setFolds];
}
