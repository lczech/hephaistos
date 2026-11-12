// What a list of commits holds: commits, and where a file was renamed, the path it had before.

import type { Schemas } from "../../api/client";
import { numberText } from "../../text";
import type { Checkout } from "../checkout";
import { Layout } from "./lanes";

export type Commit = Schemas["CommitJson"];
export type Ref = Schemas["RefJson"];
export type Found = Schemas["FoundCommitJson"];

/** What is not committed in a Checkout, above its HEAD: History's own, or one of a Graph's. */
export interface Uncommitted {
  type: "uncommitted";
  text: string;
  of?: { checkout: Checkout; head: string; key: string }; // a Graph's: its Checkout and HEAD
}

/** A commit as a graph lays it out: listed, or only walked (`/api/graph/lines`). */
export type Line = Pick<Commit, "hash" | "parents" | "refs">;

/** The rows a graph lays out: commits, listed or only walked, and what is not committed; others
 * have no row in it. */
export type Laid = Uncommitted | { type: "commit"; commit: Line } | { type: "found" | "renamed" };

export type Entry =
  | Uncommitted // above the commits, when HEAD's are shown
  | { type: "found"; found: Found } // a commit searched for by its hash, not among them
  | { type: "commit"; commit: Commit }
  | { type: "renamed"; commit: string; from: string }; // below the commit that renamed it

/** The rows of these commits, newest first: each once, and below one that renamed the file,
 * where it was before. */
export function entries(commits: Commit[]): Entry[] {
  const seen = new Set<string>();
  return commits.flatMap((commit): Entry[] => {
    if (seen.has(commit.hash)) return []; // pages may overlap while new commits come
    seen.add(commit.hash);
    const row: Entry = { type: "commit", commit };
    return commit.renamed_from === null
      ? [row]
      : [row, { type: "renamed", commit: commit.hash, from: commit.renamed_from }];
  });
}

/** The rows of commits searched for, with the commit a hash searched for named first: as one
 * of them if listed, else saying where it is. */
export function searchedEntries(found: Found | null | undefined, commits: Commit[]): Entry[] {
  if (!found) return entries(commits);
  if (found.where === "listed") return entries([found.commit, ...commits]);
  return [{ type: "found", found }, ...entries(commits)];
}

/** Where a commit searched for by its hash is, if not listed: `not on main, but on:`. */
export function whereText(found: Found, walked: string, path: string | undefined): string {
  if (found.where === "path") return `does not change ${path}`;
  if (found.where === "refs") return `not on ${walked}, but on:`;
  return "no branch or tag leads to it any more";
}

export function entryId(entry: Entry): string {
  if (entry.type === "uncommitted") return uncommittedId(entry);
  if (entry.type === "found") return `found:${entry.found.commit.hash}`;
  return entry.type === "commit" ? entry.commit.hash : `renamed:${entry.commit}`;
}

/** The ID of the row of what is not committed: History's own, or a Graph's, by its Checkout. */
function uncommittedId(entry: Uncommitted): string {
  return entry.of ? `uncommitted:${entry.of.key}` : "uncommitted";
}

/** What a Checkout's State says is not committed, in words; empty for a bare Clone, or none. */
export function uncommittedIn(
  state:
    | {
        conflicted: number | null;
        staged: number | null;
        changed: number | null;
        untracked: number | null;
      }
    | undefined,
): string {
  if (state === undefined || state.staged === null) return ""; // bare: no working tree
  return uncommittedText({
    conflicted: state.conflicted ?? 0,
    staged: state.staged,
    changed: state.changed ?? 0,
    untracked: state.untracked ?? 0,
  });
}

/** How many files of each kind are not committed: `2 staged, 5 changed, 3 untracked`. */
export function uncommittedText(counts: {
  conflicted: number;
  staged: number;
  changed: number;
  untracked: number;
}): string {
  const parts: [number, string][] = [
    [counts.conflicted, "conflicted"],
    [counts.staged, "staged"],
    [counts.changed, "changed"],
    [counts.untracked, "untracked"],
  ];
  return parts
    .filter(([count]) => count > 0)
    .map(([count, what]) => `${numberText(count)} ${what}`)
    .join(", ");
}

/** Whether someone else committed it than wrote it: only then is the committer worth showing. */
export function committedApart(author: Commit["author"], committer: Commit["author"]): boolean {
  return author.name !== committer.name || author.email !== committer.email;
}

/** The graph of the commits listed, and the row of each entry in it, by its ID. */
export interface Drawn {
  layout: Layout;
  rows: Map<string, number>;
  drawing: Drawing;
}

/**
 * How a list draws its graph: HEAD's commit and the others drawn as HEADs, and which line takes
 * lane 0 and the accent: the first, as History's from where it starts, or a pinned commit's, as
 * the Graph View's default branch; none, `pinned` without one.
 */
export interface Drawing {
  heads: ReadonlySet<string>;
  accent?: "first" | "pinned"; // by default `pinned` if a commit is, else `first`
  pinned?: string;
  checkedOut?: CheckedOut[]; // where the Checkouts are, marked on the badges
  first?: string; // the default branch, the first of the badges
  hidden?: ReadonlySet<string>; // local branches hidden: without badges, naming no lane
}

/** A Checkout of a Clone, as a Graph marks where it is: on its branch's badge, or by a HEAD badge
 * of its own when detached. */
export interface CheckedOut {
  name: string; // the folder of the Clone or Worktree
  worktree: boolean; // a Worktree, else the main working tree of the Clone
  branch: string | null; // null when detached
  commit: string | null; // null before the first commit
}

/**
 * The graph of these entries, newest first: their commits, and above HEAD's what is not
 * committed. Other entries have no row in it.
 */
export function graphOf(
  entries: readonly Laid[],
  head: string | null | undefined,
  drawing: Drawing,
): Drawn {
  const { heads, pinned, accent = pinned === undefined ? "first" : "pinned" } = drawing;
  const layout = new Layout({ heads, pinned, accent });
  const rows = new Map<string, number>();
  for (const entry of entries) {
    if (entry.type === "commit") {
      const { hash, parents, refs } = entry.commit;
      rows.set(hash, layout.rows.length);
      layout.add({ hash, parents, branch: branchOf(shownRefs(refs, drawing)) });
    } else if (entry.type === "uncommitted" && (entry.of?.head ?? head)) {
      const id = uncommittedId(entry);
      rows.set(id, layout.rows.length);
      const parent = (entry.of?.head ?? head) as string;
      layout.add({ hash: id, parents: [parent], uncommitted: true });
    }
  }
  return { layout, rows, drawing };
}

/** The refs a graph labels a commit with: all but the local branches hidden. */
export function shownRefs(refs: Ref[], drawing: Drawing | undefined): Ref[] {
  const hidden = drawing?.hidden;
  if (hidden === undefined || hidden.size === 0) return refs;
  return refs.filter((ref) => ref.kind !== "branch" || !hidden.has(ref.name));
}

/** The branch a commit's lane is named by: a local one, else a remote one by its own name. */
export function branchOf(refs: Ref[]): string | undefined {
  const local = refs.find((ref) => ref.kind === "branch");
  if (local) return local.name;
  const remote = refs.find((ref) => ref.kind === "remote");
  return remote?.name.slice(remote.name.indexOf("/") + 1);
}
