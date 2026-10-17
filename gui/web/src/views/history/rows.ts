// What the History list holds: commits, and where a file was renamed, the path it had before.

import type { Schemas } from "../../api/client";
import { pathParts } from "../changes/rows";

export type Commit = Schemas["CommitJson"];
export type Ref = Schemas["RefJson"];

export type Entry =
  | { type: "uncommitted"; text: string } // above the commits, when HEAD's are shown
  | { type: "commit"; commit: Commit }
  | { type: "renamed"; commit: string; from: string }; // below the commit that renamed it

/** A commit's hash as git shortens it at least: `abc1234`. */
export function shortHash(hash: string): string {
  return hash.slice(0, 7);
}

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

export function entryId(entry: Entry): string {
  if (entry.type === "uncommitted") return "uncommitted";
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
    .map(([count, what]) => `${count} ${what}`)
    .join(", ");
}

/** What HEAD is: `HEAD (main)`, or `HEAD (detached at abc1234)`; `HEAD` before the first. */
export function headText(head: string | null | undefined, branch: string | null | undefined) {
  if (branch) return `HEAD (${branch})`;
  return head ? `HEAD (detached at ${shortHash(head)})` : "HEAD";
}

/** The tab's title: `History: proj`, `History: proj, origin/main`, `History: rows.ts`. */
export function historyTitle(
  name: string | undefined,
  ref: string | undefined,
  path: string | undefined,
): string | undefined {
  const shown = path === undefined ? name : pathParts(path)[1];
  if (shown === undefined) return undefined;
  return `History: ${shown}${ref === undefined ? "" : `, ${ref}`}`;
}

/** Whether someone else committed it than wrote it: only then is the committer worth showing. */
export function committedApart(author: Commit["author"], committer: Commit["author"]): boolean {
  return author.name !== committer.name || author.email !== committer.email;
}
