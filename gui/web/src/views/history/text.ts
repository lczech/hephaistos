// What History says in words: its title, and that a search found nothing.

import { pathParts } from "../../paths";
import { revisionText } from "../../revisions";
import { listText } from "../../text";

/** The tab's title: `History: proj`, `History: proj, origin/main`, `History: rows.ts`; refs and
 * hashes shortened. */
export function historyTitle(
  name: string | undefined,
  ref: string | undefined,
  path: string | undefined,
  search: string[] = [],
): string | undefined {
  const shown = path === undefined ? name : pathParts(path)[1];
  if (shown === undefined) return undefined;
  const searched = search.length > 0 ? `, “${search.join(" ")}”` : "";
  return `History: ${shown}${ref === undefined ? "" : `, ${revisionText(ref)}`}${searched}`;
}

/** That no commits have all the words searched for: `No commits mention row and view.` */
export function noneFoundText(words: string[], path: string | undefined): string {
  return `No commits ${path === undefined ? "" : `that changed ${path} `}mention ${listText(words)}.`;
}
