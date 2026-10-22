import { describe, expect, it } from "vitest";
import { type Found, find } from "./matcher";
import { findPattern, type Pattern } from "./pattern";

/** What finding the pattern found, once done. */
function found(lines: string[], pattern: Pattern): Promise<Found> {
  return new Promise((done) => find(lines, pattern, done));
}

function pattern(text: string, regex = false): Pattern {
  const made = findPattern({ text, matchCase: false, wholeWord: false, regex });
  if ("error" in made) throw new Error(made.error);
  return made;
}

// Where there are workers: not WebKit's tests (`test/browser.ts`).
describe.skipIf(typeof Worker === "undefined")("finding in a worker", () => {
  it("finds the pattern's matches", async () => {
    expect(await found(["a b a", "b"], pattern("a"))).toEqual({
      matches: [
        { line: 0, start: 0, end: 1 },
        { line: 0, start: 4, end: 5 },
      ],
      more: false,
    });
  });

  it("stops a regular expression taking too long, then finds again", async () => {
    // Each of the a's in one group or another: twice as many ways for each more, before the b.
    const runaway = pattern("^(a+)+$", true);
    const started = performance.now();
    expect(await found([`${"a".repeat(40)}b`], runaway)).toEqual({
      error: "Stopped after 5 s: the expression takes too long",
    });
    expect(performance.now() - started).toBeLessThan(6_000);
    expect(await found(["a"], pattern("a"))).toEqual({
      matches: [{ line: 0, start: 0, end: 1 }],
      more: false,
    });
  });

  it("stops one search for another", async () => {
    const results: Found[] = [];
    const stop = find([`${"a".repeat(40)}b`], pattern("^(a+)+$", true), (found) =>
      results.push(found),
    );
    stop();
    expect(await found(["aa"], pattern("a"))).toMatchObject({ matches: [{}, {}] });
    expect(results).toEqual([]);
  });
});
