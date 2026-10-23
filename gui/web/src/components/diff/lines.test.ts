import { describe, expect, it } from "vitest";
import { diffLines } from "./lines";

// Two hunks of a 12-line file: line 3 changed into two, line 9 removed; a line around each.
const PATCH = `diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -2,3 +2,4 @@
 2
-3
+three
+3½
 4
@@ -8,3 +9,2 @@
 8
-9
 10
`;
const NEW = "1\n2\nthree\n3½\n4\n5\n6\n7\n8\n10\n11\n12\n";

const text = (lines: ReturnType<typeof diffLines>) => lines.map((line) => line.text);

describe("a diff's lines", () => {
  it("are the patch's, each unchanged one once, with their numbers in both versions", () => {
    const collapsed = false;
    expect(diffLines(PATCH)).toEqual([
      { text: "2", old: 2, new: 2, collapsed },
      { text: "3", old: 3, new: null, collapsed },
      { text: "three", old: null, new: 3, collapsed },
      { text: "3½", old: null, new: 4, collapsed },
      { text: "4", old: 4, new: 5, collapsed },
      { text: "8", old: 8, new: 9, collapsed },
      { text: "9", old: 9, new: null, collapsed },
      { text: "10", old: 10, new: 10, collapsed },
    ]);
  });

  it("are all of the file's with its new version, before, between and after the hunks", () => {
    const lines = diffLines(PATCH, NEW);
    expect(text(lines)).toEqual([
      "1",
      "2",
      "3",
      "three",
      "3½",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
      "11",
      "12",
    ]);
    // Lines left out are collapsed, but one alone, as the renderer shows it: here, line 1.
    expect(lines[0]).toEqual({ text: "1", old: 1, new: 1, collapsed: false });
    expect(lines[1]).toEqual({ text: "2", old: 2, new: 2, collapsed: false });
    expect(lines[6]).toEqual({ text: "5", old: 5, new: 6, collapsed: true });
    expect(lines[13]).toEqual({ text: "12", old: 12, new: 12, collapsed: true });
  });

  it("are a new file's added lines, and a deleted file's removed ones", () => {
    const added =
      "diff --git a/n b/n\nnew file mode 100644\n--- /dev/null\n+++ b/n\n@@ -0,0 +1,2 @@\n+a\n+b\n";
    expect(diffLines(added, "a\nb\n")).toEqual([
      { text: "a", old: null, new: 1, collapsed: false },
      { text: "b", old: null, new: 2, collapsed: false },
    ]);
    const deleted =
      "diff --git a/d b/d\ndeleted file mode 100644\n--- a/d\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-a\n-b\n";
    expect(diffLines(deleted, null)).toEqual([
      { text: "a", old: 1, new: null, collapsed: false },
      { text: "b", old: 2, new: null, collapsed: false },
    ]);
  });

  it("leave out git's notes, e.g. of no newline at the end", () => {
    const patch = "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n";
    expect(text(diffLines(patch))).toEqual(["a", "b"]);
  });
});
