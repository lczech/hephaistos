// What the Graph View says in words.

import { numberText } from "../../text";

/** The tab's title: `Graph: proj`, `Graph: proj, 2 hidden` while branches are hidden. */
export function graphTitle(name: string | undefined, hidden: number): string | undefined {
  if (name === undefined) return undefined;
  return `Graph: ${name}${hidden > 0 ? `, ${numberText(hidden)} hidden` : ""}`;
}
