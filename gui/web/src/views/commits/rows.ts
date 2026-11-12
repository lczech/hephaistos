// What a list of commits holds: commits, and where a file was renamed, the path it had before.

import type { Schemas } from "../../api/client";
import { numberText } from "../../text";
import { Layout } from "./lanes";

export type Commit = Schemas["CommitJson"];
export type Ref = Schemas["RefJson"];
export type Found = Schemas["FoundCommitJson"];

export type Entry =
  | { type: "uncommitted"; text: string } // above the commits, when HEAD's are shown
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
  if (entry.type === "uncommitted") return "uncommitted";
  if (entry.type === "found") return `found:${entry.found.commit.hash}`;
  return entry.type === "commit" ? entry.commit.hash : `renamed:${entry.commit}`;
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
}

/**
 * How a list draws its graph: HEAD's commit and the others drawn as HEADs, and which line takes
 * lane 0 and the accent: the first, as History's from where it starts, or a pinned commit's, as
 * the Graph View's default branch.
 */
export interface Drawing {
  heads: ReadonlySet<string>;
  pinned?: string;
}

/**
 * The graph of these entries, newest first: their commits, and above HEAD's what is not
 * committed. Other entries have no row in it.
 */
export function graphOf(
  entries: Entry[],
  head: string | null | undefined,
  drawing: Drawing,
): Drawn {
  const { heads, pinned } = drawing;
  const layout = new Layout({ heads, pinned, accent: pinned === undefined ? "first" : "pinned" });
  const rows = new Map<string, number>();
  for (const entry of entries) {
    if (entry.type === "commit") {
      const { hash, parents, refs } = entry.commit;
      rows.set(entryId(entry), layout.rows.length);
      layout.add({ hash, parents, branch: branchOf(refs) });
    } else if (entry.type === "uncommitted" && head) {
      rows.set(entryId(entry), layout.rows.length);
      layout.add({ hash: entryId(entry), parents: [head], uncommitted: true });
    }
  }
  return { layout, rows };
}

/** The branch a commit's lane is named by: a local one, else a remote one by its own name. */
export function branchOf(refs: Ref[]): string | undefined {
  const local = refs.find((ref) => ref.kind === "branch");
  if (local) return local.name;
  const remote = refs.find((ref) => ref.kind === "remote");
  return remote?.name.slice(remote.name.indexOf("/") + 1);
}
