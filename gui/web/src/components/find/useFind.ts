import { useEffect, useState } from "react";
import { type Found, find } from "./matcher";
import { type FindQuery, findPattern } from "./pattern";

/** What a find found so far: while it looks again, what it found before, if anything. */
export type Finding = (Found & { busy: boolean }) | { busy: true };

interface Searched {
  lines: readonly string[];
  source: string;
  flags: string;
  found: Found;
}

/**
 * The query's matches in the lines, found off the page (`matcher.ts`), again as either changes;
 * undefined without anything to look for.
 */
export function useFind(
  lines: readonly string[] | undefined,
  query: FindQuery | undefined,
): Finding | undefined {
  const pattern = query && query.text !== "" ? findPattern(query) : undefined;
  const source = pattern && "source" in pattern ? pattern.source : undefined;
  const flags = pattern && "flags" in pattern ? pattern.flags : undefined;
  const [searched, setSearched] = useState<Searched>();
  useEffect(() => {
    if (lines === undefined || source === undefined || flags === undefined) return;
    return find(lines, { source, flags }, (found) => setSearched({ lines, source, flags, found }));
  }, [lines, source, flags]);
  if (pattern === undefined || lines === undefined) return undefined;
  if ("error" in pattern) return { error: pattern.error, busy: false };
  const current =
    searched?.lines === lines && searched.source === source && searched.flags === flags;
  if (searched === undefined) return { busy: true };
  return { ...searched.found, busy: !current };
}

/**
 * Which of `count` matches is the current one, and a way to step to the next or the one before,
 * round; the first again once the matches are others (`of`, which stays the same as long).
 */
export function useCurrentMatch(of: unknown, count: number): [number, (by: 1 | -1) => void] {
  const [current, setCurrent] = useState<{ of: unknown; at: number }>({ of: undefined, at: 0 });
  const at = current.of === of && current.at < count ? current.at : 0;
  const step = (by: 1 | -1) => {
    if (count > 0) setCurrent({ of, at: (at + by + count) % count });
  };
  return [at, step];
}
