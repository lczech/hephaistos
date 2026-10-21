import { describe, expect, it } from "vitest";
import { diffRows, lineCount } from "./height";

// Two hunks of a 20-line file: one changing line 3 (a line removed, two added), one removing line
// 10, each with a line around it.
const PATCH = `diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -2,3 +2,4 @@
 2
-3
+three
+3½
 4
@@ -9,3 +10,2 @@
 9
-10
 11
\\ No newline at end of file
`;

const look = { split: false, wrap: false, whole: false };

describe("a diff's height", () => {
  it("counts the patch's rows, inline or side by side", () => {
    expect(diffRows(PATCH, look).rows).toBe(8);
    expect(diffRows(PATCH, { ...look, split: true }).rows).toBe(7);
  });

  it("has bands before, between and after its hunks, where the file goes on", () => {
    expect(diffRows(PATCH, look)).toMatchObject({ bands: 2, ends: 1 }); // after: unknown
    expect(diffRows(PATCH, look, 20)).toMatchObject({ bands: 3, ends: 0 });
    expect(diffRows(PATCH, look, 11)).toMatchObject({ bands: 2, ends: 1 }); // ends with the last hunk
  });

  it("is the whole file, and the lines removed, once the file is shown whole", () => {
    expect(diffRows(PATCH, { ...look, whole: true }, 20)).toEqual({ rows: 22, bands: 0, ends: 2 });
    expect(diffRows(PATCH, { ...look, split: true, whole: true }, 20)).toEqual({
      rows: 21,
      bands: 0,
      ends: 2,
    });
  });

  it("counts a text's lines, with or without a newline at its end", () => {
    expect([lineCount(""), lineCount("a\n"), lineCount("a\nb")]).toEqual([0, 1, 2]);
  });
});
