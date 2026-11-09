import { useEffect, useState } from "react";
import { type Found, find } from "./matcher";
import { type FindQuery, findPattern, type Per } from "./pattern";

/**
 * What a find found so far: while it looks again, what it found before, if anything, with the
 * lines it found it in (`in`), which may be others than those given now: its matches' line
 * numbers are of those.
 */
export type Finding = (Found & { busy: boolean; in: readonly string[] }) | { busy: true };

interface Searched {
  lines: readonly string[];
  source: string;
  flags: string;
  found: Found;
}

/**
 * The query's matches in the lines, found off the page (`matcher.ts`), again as either changes;
 * undefined without anything to look for. The limit counts matches, or `per` line, the lines
 * matched.
 */
export function useFind(
  lines: readonly string[] | undefined,
  query: FindQuery | undefined,
  per: Per = "match",
): Finding | undefined {
  const pattern = query && query.text !== "" ? findPattern(query) : undefined;
  const source = pattern && "source" in pattern ? pattern.source : undefined;
  const flags = pattern && "flags" in pattern ? pattern.flags : undefined;
  const [searched, setSearched] = useState<Searched>();
  useEffect(() => {
    if (lines === undefined || source === undefined || flags === undefined) return;
    return find(
      lines,
      { source, flags },
      (found) => setSearched({ lines, source, flags, found }),
      per,
    );
  }, [lines, source, flags, per]);
  if (pattern === undefined || lines === undefined) return undefined;
  if ("error" in pattern) return { error: pattern.error, busy: false, in: lines };
  const current =
    searched?.lines === lines && searched.source === source && searched.flags === flags;
  if (searched === undefined) return { busy: true };
  return { ...searched.found, busy: !current, in: searched.lines };
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
