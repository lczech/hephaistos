// A View's find bar in its address: `find=` while it is open, even with nothing typed, and
// `case`, `word`, `regex` while those are on. Which match is the current one isn't in it.
import type { FindQuery } from "../components/find/pattern";
import { type Params, paramValues, withParam } from "./address";

const OPTIONS = { matchCase: "case", wholeWord: "word", regex: "regex" } as const;

/** What the find bar looks for; undefined while it is closed. */
export function findOf(params: Params): FindQuery | undefined {
  const [text] = paramValues(params.find);
  if (text === undefined) return undefined;
  const on = (name: string) => params[name] !== undefined;
  return {
    text,
    matchCase: on(OPTIONS.matchCase),
    wholeWord: on(OPTIONS.wholeWord),
    regex: on(OPTIONS.regex),
  };
}

/** These parameters with the find bar looking for this, or closed. */
export function withFind(params: Params, query: FindQuery | undefined): Params {
  let next = withParam(params, "find", query ? [query.text] : []);
  for (const [option, name] of Object.entries(OPTIONS) as [keyof typeof OPTIONS, string][]) {
    next = withParam(next, name, query?.[option] ? ["1"] : []);
  }
  return next;
}

/** A find bar opened, nothing typed yet. */
export const NOTHING_TYPED: FindQuery = {
  text: "",
  matchCase: false,
  wholeWord: false,
  regex: false,
};
