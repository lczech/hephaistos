// What the Graph View says in words.

import { numberText } from "../../text";

/** The tab's title: `Graph: proj`, `Graph: proj, 2 hidden` while branches are hidden. */
export function graphTitle(name: string | undefined, hidden: number): string | undefined {
  if (name === undefined) return undefined;
  return `Graph: ${name}${hidden > 0 ? `, ${numberText(hidden)} hidden` : ""}`;
}

/** How far a Checkout is ahead of a branch and behind it, short: `↑3 ↓12`, zero parts left out;
 * empty when level or not known. */
export function standingText(ahead: number | null, behind: number | null): string {
  const parts = [
    ...(ahead ? [`↑${numberText(ahead)}`] : []),
    ...(behind ? [`↓${numberText(behind)}`] : []),
  ];
  return parts.join(" ");
}

/** The same in words, for a tooltip: `3 ahead of main, 12 behind`, `level with main`. */
export function standingWords(
  ahead: number | null,
  behind: number | null,
  against: string | null,
): string | undefined {
  if (against === null || ahead === null || behind === null) return undefined;
  if (ahead === 0 && behind === 0) return `level with ${against}`;
  if (behind === 0) return `${numberText(ahead)} ahead of ${against}`;
  if (ahead === 0) return `${numberText(behind)} behind ${against}`;
  return `${numberText(ahead)} ahead of ${against}, ${numberText(behind)} behind`;
}

/** What a Checkout has out, in git's words: `feature`, `detached at abc1234`, `no commits`. */
export function checkedOutText(branch: string | null, commit: string | null): string {
  if (branch !== null) return branch;
  return commit === null ? "no commits" : `detached at ${commit.slice(0, 7)}`;
}
