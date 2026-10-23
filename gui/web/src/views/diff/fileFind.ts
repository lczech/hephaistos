import { useState } from "react";
import type { DiffMark } from "../../components/diff/Diff";
import { type DiffLine, diffLines } from "../../components/diff/lines";
import type { FindQuery } from "../../components/find/pattern";
import { type Finding, useFind } from "../../components/find/useFind";

interface Lines {
  patch: string;
  newText: string | null | undefined;
  lines: DiffLine[];
  texts: string[];
}

/**
 * A query's matches in one file's lines: all of them once its new version is known (`newText`),
 * the patch's until then; as marks for the renderer. Held while what they come from stays, as
 * React keeps what a render showed, rather than memoized: a search starts again only once the
 * lines or the query change, and a current match stays one while the marks do.
 */
export function useFileFind(
  patch: string | undefined,
  newText: string | null | undefined,
  query: FindQuery | undefined,
): { finding: Finding | undefined; marks: readonly DiffMark[] } {
  const [held, setHeld] = useState<Lines>();
  let lines = held;
  if (patch === undefined) lines = undefined;
  else if (held?.patch !== patch || held.newText !== newText) {
    const all = diffLines(patch, newText);
    lines = { patch, newText, lines: all, texts: all.map((line) => line.text) };
    setHeld(lines);
  }
  const finding = useFind(query && lines?.texts, query);
  const matches = finding && "matches" in finding ? finding.matches : undefined;
  const [marked, setMarked] = useState<{ matches: typeof matches; marks: DiffMark[] }>({
    matches: undefined,
    marks: [],
  });
  let marks = marked.marks;
  if (marked.matches !== matches) {
    marks = (matches ?? []).flatMap(({ line, start, end }) => {
      const at = lines?.lines[line];
      return at ? [{ old: at.old, new: at.new, start, end, inPatch: at.inPatch }] : [];
    });
    setMarked({ matches, marks });
  }
  return { finding, marks };
}
