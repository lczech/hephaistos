// The lines a diff shows, in order, e.g. to find in: those of git's patch, or with the whole
// file, all of them. Apart from `Diff`, which would load the renderer.

import { lineCount } from "./height";

/** A line shown: its text, and its numbers in the old and new versions, where it is in them. */
export interface DiffLine {
  text: string;
  old: number | null; // null: added
  new: number | null; // null: removed
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * The lines of git's patch for one file, lines unchanged once each (side by side, on both
 * sides), removed ones before those added after them; with its new version (`newText`), every
 * line of the file too, between and around its hunks.
 */
export function diffLines(patch: string, newText?: string | null): DiffLine[] {
  const whole = typeof newText === "string" ? newText.split("\n") : undefined;
  const lines: DiffLine[] = [];
  let next = 1; // the new version's first line not shown yet
  let delta = 0; // a line's number in the old version, less its number in the new one
  // The new version's lines from `next` on, up to `to`, unchanged.
  const unchanged = (to: number) => {
    for (; whole && next <= to; next++) {
      lines.push({ text: whole[next - 1] ?? "", old: next + delta, new: next });
    }
  };
  let old = 0;
  let current = 0;
  let inHunk = false;
  for (const line of patch.split("\n")) {
    const hunk = HUNK.exec(line);
    if (hunk) {
      const [oldStart, oldCount, newStart, newCount] = hunk.slice(1).map((n) => Number(n ?? 1));
      // A hunk of none of the new version's lines starts after the line it names.
      const first = newCount === 0 ? (newStart as number) + 1 : (newStart as number);
      unchanged(first - 1);
      old = oldCount === 0 ? (oldStart as number) + 1 : (oldStart as number);
      current = first;
      next = first + (newCount as number);
      delta = old + (oldCount as number) - next;
      inHunk = true;
    } else if (inHunk) {
      // Within hunks, not the patch's header, whose lines start alike.
      const text = line.slice(1);
      if (line.startsWith(" ")) lines.push({ text, old: old++, new: current++ });
      else if (line.startsWith("-")) lines.push({ text, old: old++, new: null });
      else if (line.startsWith("+")) lines.push({ text, old: null, new: current++ });
    }
  }
  if (newText) unchanged(lineCount(newText));
  return lines;
}
