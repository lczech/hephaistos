import { getSingularPatch } from "@pierre/diffs";
import { describe, expect, it } from "vitest";
import { withVersions } from "./Diff";

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
