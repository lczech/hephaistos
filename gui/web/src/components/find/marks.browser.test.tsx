import { afterEach, describe, expect, it } from "vitest";
import { markMatches, rangeIn } from "./marks";

/** The text each highlight marks. */
function marked(name: string): string[] {
  return [...(CSS.highlights.get(name) ?? [])].map((range) => (range as Range).toString());
}

afterEach(() => document.body.replaceChildren());

describe("marking matches", () => {
  it("finds a match's text across the elements within a line", () => {
    const line = document.createElement("div");
    line.innerHTML = "<span>con</span><span>st x</span> = 1";
    document.body.append(line);
    expect(rangeIn(line, 1, 6)?.toString()).toBe("onst ");
    expect(rangeIn(line, 0, 3)?.toString()).toBe("con");
    expect(rangeIn(line, 8, 11)?.toString()).toBe("= 1");
    expect(rangeIn(line, 8, 20)).toBeUndefined(); // past its end
  });

  it("marks matches, the current one apart, and takes them out again", () => {
    const line = document.createElement("div");
    line.textContent = "a b a";
    document.body.append(line);
    const ranges = [rangeIn(line, 0, 1), rangeIn(line, 4, 5)] as Range[];
    const unmark = markMatches([
      { range: ranges[0] as Range, current: false },
      { range: ranges[1] as Range, current: true },
    ]);
    expect(marked("hephaistos-found")).toEqual(["a"]);
    expect(marked("hephaistos-found-current")).toEqual(["a"]);
    unmark();
    expect(marked("hephaistos-found")).toEqual([]);
    expect(marked("hephaistos-found-current")).toEqual([]);
  });
});
