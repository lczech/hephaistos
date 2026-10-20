import { FileDiff, GitCompareArrows } from "lucide-react";
import { describe, expect, it } from "vitest";
import { FileDiffs } from "../drawnIcons";
import { viewIcon } from "./kinds";

describe("a View's icon", () => {
  it("is its kind's, or as its parameters make it", () => {
    const compared = { clone: "clone-proj", from: "HEAD", to: "index" };
    expect(viewIcon({ kind: "changes", params: compared })).toBe(GitCompareArrows);
    expect(viewIcon({ kind: "diff", params: { ...compared, path: "a.py" } })).toBe(FileDiff);
    expect(viewIcon({ kind: "diff", params: compared })).toBe(FileDiffs);
    expect(viewIcon({ kind: "diff", params: {} })).toBe(FileDiff); // nothing compared yet
    expect(viewIcon({ kind: "unknown", params: {} })).toBeUndefined();
  });
});
