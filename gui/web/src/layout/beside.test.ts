import { describe, expect, it } from "vitest";
import { type Box, besideOf } from "./beside";

const box = (left: number, top: number, width: number, height: number): Box => ({
  left,
  top,
  width,
  height,
});

/** Groups by name, `from` among them; the one beside `from`, by name. */
function beside(groups: Record<string, Box>, from = "from"): string | undefined {
  const others = Object.entries(groups)
    .filter(([name]) => name !== from)
    .map(([item, box]) => ({ item, box }));
  return besideOf(groups[from] as Box, others);
}

describe("the Group beside another", () => {
  it("is none when the Group is alone", () => {
    expect(beside({ from: box(0, 0, 800, 600) })).toBeUndefined();
  });

  it("is the one to the right first, then below, left, above", () => {
    const right = box(400, 0, 400, 600);
    const below = box(0, 300, 400, 300);
    const left = box(0, 0, 400, 600);
    const above = box(0, 0, 400, 300);
    expect(beside({ from: box(0, 0, 400, 300), right, below })).toBe("right");
    expect(beside({ from: box(400, 0, 400, 300), below: box(400, 300, 400, 300), left })).toBe(
      "below",
    );
    expect(
      beside({
        from: box(400, 300, 400, 300),
        left: box(0, 0, 400, 600),
        above: box(400, 0, 400, 300),
      }),
    ).toBe("left");
    expect(beside({ from: box(0, 300, 800, 300), above: box(0, 0, 800, 300) })).toBe("above");
    expect(beside({ from: box(0, 0, 400, 300), above, right })).toBe("right");
  });

  it("is the topmost of several to the right, and the leftmost of several below", () => {
    const from = box(0, 0, 400, 300);
    expect(beside({ from, low: box(400, 150, 400, 450), high: box(400, 0, 400, 150) })).toBe(
      "high",
    );
    const wide = box(0, 0, 800, 300);
    expect(
      beside({ from: wide, second: box(400, 300, 400, 300), first: box(0, 300, 400, 300) }),
    ).toBe("first");
  });

  it("must touch, along more than a corner", () => {
    const from = box(0, 0, 400, 300);
    expect(
      beside({ from, apart: box(500, 0, 300, 300), corner: box(400, 300, 400, 300) }),
    ).toBeUndefined();
    expect(beside({ from, sash: box(401, 0, 399, 300) })).toBe("sash");
  });
});
