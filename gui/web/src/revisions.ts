// Revisions: a commit as git names it, or the index or working tree, which our API names so.

export const INDEX = "index";
export const WORKING_TREE = "working-tree";
export const HEAD = "HEAD";

const SHORTENED = ["refs/heads/", "refs/remotes/", "refs/tags/"];
const FULL_HASH = /^[0-9a-f]{40}$/;

/** A commit's hash as git shortens it at least: `abc1234`. */
export function shortHash(hash: string): string {
  return hash.slice(0, 7);
}

/** A revision in words: `working tree`; a full ref name or hash shortened as git shows them,
 * `main` or `abc1234`; others as named. */
export function revisionText(revision: string): string {
  if (revision === WORKING_TREE) return "working tree";
  if (FULL_HASH.test(revision)) return shortHash(revision);
  const prefix = SHORTENED.find((known) => revision.startsWith(known));
  return prefix === undefined ? revision : revision.slice(prefix.length);
}
