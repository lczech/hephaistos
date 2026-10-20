// How high the renderer draws a diff, about, to hold its place until drawn: counted here, sized
// by CSS (rows of code, and bands where lines are left out between hunks). Lines that wrap make
// it higher. Apart from `Diff`, which would load the renderer.

import type { DiffLook } from "./Diff";

/** A diff's rows of code, and its bands of lines left out. */
export interface DiffRows {
  rows: number;
  bands: number;
}

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/** How many lines a file's text has. */
export function lineCount(text: string): number {
  if (text === "") return 0;
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

/**
 * The rows and bands of git's patch for one file, as the renderer shows it: side by side, each
 * run of lines removed beside the lines added after it; with the whole file (`newLines`, its new
 * version's), all of it. Bands before the first hunk, between hunks, and after the last, where
 * the file goes on (known only with `newLines`).
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
      hunks.push([Number(hunk[1]), hunk[2] === undefined ? 1 : Number(hunk[2])]);
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
  if (look.whole && newLines !== undefined) return { rows: newLines + extra, bands: 0 };
  const [first] = hunks;
  const last = hunks.at(-1);
  if (first === undefined || last === undefined) return { rows, bands: 0 };
  const before = first[0] > 1 ? 1 : 0;
  const after = newLines !== undefined && last[0] + last[1] - 1 < newLines ? 1 : 0;
  return { rows, bands: hunks.length - 1 + before + after };
}
