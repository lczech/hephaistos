import { describe, expect, it } from "vitest";
import { headText, revisionText, WORKING_TREE } from "./revisions";

const HASH = "0123456789abcdef0123456789abcdef01234567";

describe("revisions", () => {
  it("names HEAD by its branch, or detached by its commit, or alone before the first", () => {
    expect(headText(HASH, "main")).toBe("HEAD (main)");
    expect(headText(HASH, null)).toBe("HEAD (detached at 0123456)");
    expect(headText(null, null)).toBe("HEAD");
    expect(headText(undefined, undefined)).toBe("HEAD");
  });

  it("shortens full ref names and hashes as git shows them, and names the working tree", () => {
    expect(revisionText("refs/heads/main")).toBe("main");
    expect(revisionText("refs/remotes/origin/main")).toBe("origin/main");
    expect(revisionText("refs/tags/v1.0")).toBe("v1.0");
    expect(revisionText(HASH)).toBe("0123456");
    expect(revisionText(WORKING_TREE)).toBe("working tree");
    expect(revisionText("HEAD~2")).toBe("HEAD~2");
  });
});
