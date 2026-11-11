// What a list of commits holds: commits, and where a file was renamed, the path it had before.

import type { Schemas } from "../../api/client";
import { numberText } from "../../text";

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
