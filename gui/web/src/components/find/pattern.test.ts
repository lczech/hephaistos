import { describe, expect, it } from "vitest";
import { type FindQuery, findMatches, findPattern, unicodeSource } from "./pattern";

const QUERY: FindQuery = { text: "", matchCase: false, wholeWord: false, regex: false };

/** The texts found in the lines by this query. */
function found(lines: string[], query: Partial<FindQuery>): string[] {
  const pattern = findPattern({ ...QUERY, ...query });
  if ("error" in pattern) throw new Error(pattern.error);
  const { matches } = findMatches(lines, pattern, 100);
  return matches.map(({ line, start, end }) => (lines[line] as string).slice(start, end));
}

describe("finding text", () => {
  it("finds what is typed as it is, in any case unless asked", () => {
    expect(found(["a.b (A.B)", "axb"], { text: "a.b" })).toEqual(["a.b", "A.B"]);
    expect(found(["a.b (A.B)"], { text: "A.B", matchCase: true })).toEqual(["A.B"]);
    expect(found(["Straße STRASSE"], { text: "straße" })).toEqual(["Straße"]);
  });

  it("finds whole words, in any script", () => {
    const lines = ["cat category bobcat cat_x", "Kätzchen kätz", "кот котик"];
    expect(found(lines, { text: "cat", wholeWord: true })).toEqual(["cat"]);
    expect(found(lines, { text: "kätz", wholeWord: true })).toEqual(["kätz"]);
    expect(found(lines, { text: "кот", wholeWord: true })).toEqual(["кот"]);
  });

  it("finds a regular expression, its shorthands meaning any script's words and digits", () => {
    const lines = ["naïve café ٣٤ x_1"];
    expect(found(lines, { text: "\\w+", regex: true })).toEqual(["naïve", "café", "٣٤", "x_1"]);
    expect(found(lines, { text: "\\d+", regex: true })).toEqual(["٣٤", "1"]);
    expect(found(lines, { text: "\\bca", regex: true })).toEqual(["ca"]);
    expect(found(lines, { text: "ve\\b", regex: true })).toEqual(["ve"]);
    expect(found(lines, { text: "a\\B", regex: true })).toEqual(["a", "a"]);
    expect(found(lines, { text: "[\\w-]+é", regex: true })).toEqual(["café"]);
    expect(found(["a-b c"], { text: "[\\W]", regex: true })).toEqual(["-", " "]);
    expect(found(["a-b c"], { text: "[b\\W]+", regex: true })).toEqual(["-b "]);
    expect(found(["a-b c"], { text: "[^a\\W]+", regex: true })).toEqual(["b", "c"]);
  });

  it("leaves the rest of a regular expression as written, a backspace in a class too", () => {
    expect(unicodeSource("\\p{L}\\.[\\b\\]x]")).toBe("\\p{L}\\.[\\b\\]x]");
    expect(found(["a\bb"], { text: "[\\b]", regex: true })).toEqual(["\b"]);
  });

  it("says why a regular expression is invalid", () => {
    expect(findPattern({ ...QUERY, text: "(\\w", regex: true })).toEqual({
      error: "Invalid regular expression: Unterminated group",
    });
  });

  it("finds no empty matches, and stops at its limit", () => {
    expect(found(["bab"], { text: "a*", regex: true })).toEqual(["a"]);
    expect(found(["😀😀"], { text: "x*", regex: true })).toEqual([]);
    const pattern = findPattern({ ...QUERY, text: "a" });
    if ("error" in pattern) throw new Error(pattern.error);
    expect(findMatches(["aaa", "a"], pattern, 2)).toEqual({
      matches: [
        { line: 0, start: 0, end: 1 },
        { line: 0, start: 1, end: 2 },
      ],
      more: true,
    });
  });
});
