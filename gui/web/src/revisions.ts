// Revisions: a commit as git names it, or the index or working tree, which our API names so.

export const INDEX = "index";
export const WORKING_TREE = "working-tree";
export const HEAD = "HEAD";

/** The uncommitted changes, staged or not: from HEAD to the working tree. */
export const SINCE_HEAD = { from: HEAD, to: WORKING_TREE };

const SHORTENED = ["refs/heads/", "refs/remotes/", "refs/tags/"];
// A commit hash: 40 hex digits with SHA-1, 64 with SHA-256; git abbreviates it to 4 at least.
const FULL_HASH = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
export const ABBREVIATED_HASH = /^[0-9a-f]{4,64}$/i;

/** A commit's hash as git shortens it at least: `abc1234`. */
export function shortHash(hash: string): string {
  return hash.slice(0, 7);
}

/** What HEAD is: `HEAD (main)`, or `HEAD (detached at abc1234)`; `HEAD` before the first. */
export function headText(head: string | null | undefined, branch: string | null | undefined) {
  if (branch) return `HEAD (${branch})`;
  return head ? `HEAD (detached at ${shortHash(head)})` : "HEAD";
}

/** A revision in words: `working tree`; a full ref name or hash shortened as git shows them,
 * `main` or `abc1234`; others as named. */
export function revisionText(revision: string): string {
  if (revision === WORKING_TREE) return "working tree";
  if (FULL_HASH.test(revision)) return shortHash(revision);
  const prefix = SHORTENED.find((known) => revision.startsWith(known));
  return prefix === undefined ? revision : revision.slice(prefix.length);
}
