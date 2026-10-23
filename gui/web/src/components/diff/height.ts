// How high the renderer draws a diff, about, to hold its place until drawn: counted here, sized
// by CSS (rows of code, separators standing for lines collapsed between hunks, and the room at the ends
// without one). Lines that wrap make it higher. Apart from `Diff`, which would load the renderer.

import type { DiffLook } from "./Diff";

/** A diff's rows of code, its separators standing for collapsed lines, and its ends without one. */
export interface DiffRows {
  rows: number;
  separators: number;
  ends: number; // of its two: the renderer pads each, a separator in its place
}

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/** Unchanged lines left out of a patch, around or between its hunks, that the renderer shows
 * rather than collapses, if no more: as `Diff` tells it (`collapsedContextThreshold`). Once the
 * file's versions are known; before, it collapses them all. */
export const UNCOLLAPSED = 1;

/** How many lines a file's text has. */
export function lineCount(text: string): number {
  if (text === "") return 0;
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

/**
 * The rows and separators of git's patch for one file, as the renderer shows it: side by side,
 * each run of lines removed beside the lines added after it; with the whole file (`newLines`, its
 * new version's), all of it. Separators before the first hunk, between hunks, and after the
 * last, where the file goes on (known only with `newLines`); with it, rows instead where few
 * lines are left out (`UNCOLLAPSED`).
 */
export function diffRows(patch: string, look: DiffLook, newLines?: number): DiffRows {
  let rows = 0;
  let extra = 0; // rows beyond the new version's lines: those removed, beside none side by side
  let removed = 0;
  let added = 0;
  const hunks: [number, number][] = []; // each one's first line and lines, in the new version
  const run = () => {
    rows += look.split ? Math.max(removed, added) : removed + added;
    extra += look.split ? Math.max(0, removed - added) : removed;
    removed = 0;
    added = 0;
  };
  for (const line of patch.split("\n")) {
    const hunk = HUNK.exec(line);
    if (hunk) {
      run();
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      // A hunk of none of the new version's lines starts after the line it names.
      hunks.push([Number(hunk[1]) + (count === 0 ? 1 : 0), count]);
    } else if (hunks.length > 0) {
      // Within hunks, not the patch's header, whose lines start alike.
      if (line.startsWith("-")) removed += 1;
      else if (line.startsWith("+")) added += 1;
      else if (line.startsWith(" ")) {
        run();
        rows += 1;
      }
    }
  }
  run();
  if (look.whole && newLines !== undefined)
    return { rows: newLines + extra, separators: 0, ends: 2 };
  const [first] = hunks;
  const last = hunks.at(-1);
  if (first === undefined || last === undefined) return { rows, separators: 0, ends: 0 };
  // Lines left out before each hunk, and after the last where known: each a separator, or rows.
  const before = hunks.map(([start], at) => {
    const previous = hunks[at - 1];
    return start - (previous ? previous[0] + previous[1] : 1);
  });
  const after = newLines === undefined ? 0 : newLines - (last[0] + last[1] - 1);
  const separated = (gap: number) => gap > 0 && (newLines === undefined || gap > UNCOLLAPSED);
  for (const gap of [...before, after]) if (gap > 0 && !separated(gap)) rows += gap;
  const separators = [...before, after].filter(separated).length;
  const ends = 2 - (separated(before[0] ?? 0) ? 1 : 0) - (separated(after) ? 1 : 0);
  return { rows, separators, ends };
}
