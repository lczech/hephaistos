import { getSingularPatch } from "@pierre/diffs";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Diff, { bothSides, withVersions } from "./Diff";

// The renderer's diffs, as given: each new one draws the file anew; and how often it was made.
const drawn = vi.hoisted(() => new Set<unknown>());
const made = vi.hoisted(() => ({ count: 0 }));
vi.mock("@pierre/diffs/react", async (original) => {
  const { useState } = await import("react");
  return {
    ...(await original<typeof import("@pierre/diffs/react")>()),
    FileDiff: ({ fileDiff }: { fileDiff: unknown }) => {
      useState(() => made.count++);
      drawn.add(fileDiff);
      return null;
    },
  };
});

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

describe("a diff shown", () => {
  it("stays as it is for its versions asked for again, unchanged", () => {
    const shown = {
      patch: PATCH,
      look: { split: true, wrap: false, whole: false },
      scheme: "light" as const,
    };
    const themes = { light: "github-light", dark: "github-dark" };
    const { rerender } = render(
      <Diff {...shown} themes={themes} versions={{ old: OLD, new: NEW }} />,
    );
    rerender(<Diff {...shown} themes={{ ...themes }} versions={{ old: OLD, new: NEW }} />);
    expect(drawn.size).toBe(1);
    rerender(<Diff {...shown} themes={themes} versions={{ old: OLD, new: `${NEW}9\n` }} />);
    expect(drawn.size).toBe(2);
  });

  it("starts anew once Whole file is turned on or off, as it cannot collapse lines again", () => {
    const shown = { patch: PATCH, scheme: "light" as const, versions: { old: OLD, new: NEW } };
    const themes = { light: "github-light", dark: "github-dark" };
    const look = { split: true, wrap: false, whole: false };
    const { rerender } = render(<Diff {...shown} themes={themes} look={look} />);
    const first = made.count;
    rerender(<Diff {...shown} themes={themes} look={{ ...look, split: false }} />);
    expect(made.count).toBe(first); // drawn again, not made anew
    rerender(<Diff {...shown} themes={themes} look={{ ...look, whole: true }} />);
    expect(made.count).toBe(first + 1);
    rerender(<Diff {...shown} themes={themes} look={look} />);
    expect(made.count).toBe(first + 2);
  });
});
