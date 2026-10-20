import { getSingularPatch } from "@pierre/diffs";
import { describe, expect, it } from "vitest";
import { bothSides, withVersions } from "./Diff";

const OLD = "1\n2\n3\n4\n5\n6\n7\n8\n";
const NEW = "1\n2\n3\nfour\n5\n6\n7\n8\n";
const PATCH = `diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -3,3 +3,3 @@
 3
-4
+four
 5
`;

describe("a patch with its versions", () => {
  it("knows all of the file, and so where it ends", () => {
    const filled = withVersions(getSingularPatch(PATCH), { old: OLD, new: NEW });
    expect(filled.isPartial).toBe(false);
    expect(filled.additionLines).toHaveLength(8);
  });

  it("stays the patch where a version is missing", () => {
    const partial = getSingularPatch(PATCH);
    expect(withVersions(partial, { old: null, new: NEW })).toBe(partial);
  });
});

describe("a new or deleted file", () => {
  const NEW_FILE = `diff --git a/b.txt b/b.txt
new file mode 100644
--- /dev/null
+++ b/b.txt
@@ -0,0 +1,2 @@
+1
+2
`;

  it("shows as a change, its lines on their own side", () => {
    const added = getSingularPatch(NEW_FILE);
    expect(added.type).toBe("new");
    expect(bothSides(added)).toMatchObject({ type: "change", additionLines: ["1\n", "2\n"] });
    const changed = getSingularPatch(PATCH);
    expect(bothSides(changed)).toBe(changed);
  });
});
