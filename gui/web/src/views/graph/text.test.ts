import { describe, expect, it } from "vitest";
import { checkedOutText, standingText, standingWords } from "./text";

describe("where a Checkout stands", () => {
  it("is short, leaving out the parts that are zero, empty when level", () => {
    expect(standingText(3, 0)).toBe("↑3");
    expect(standingText(0, 12)).toBe("↓12");
    expect(standingText(0, 0)).toBe("");
    expect(standingText(null, null)).toBe("");
  });

  it("is in words: level, only ahead or only behind", () => {
    expect(standingWords(0, 0, "main")).toBe("level with main");
    expect(standingWords(3, 0, "main")).toBe("3 ahead of main");
    expect(standingWords(0, 12, "main")).toBe("12 behind main");
    expect(standingWords(3, null, "main")).toBeUndefined();
  });

  it("names what is checked out, or that there are no commits", () => {
    expect(checkedOutText(null, null)).toBe("no commits");
    expect(checkedOutText(null, "abcdef0123")).toBe("detached at abcdef0");
  });
});
