import { describe, expect, it } from "vitest";
import { type Holding, rowAt, shapeOf, stuckRows } from "./stuck";

// src (holding inner and two files), inner (holding four files), then two files at the top level.
const TREE: Holding[] = [
  { depth: 0, holds: true }, // 0 src
  { depth: 1, holds: true }, // 1 inner
  { depth: 2, holds: false }, // 2
  { depth: 2, holds: false }, // 3
  { depth: 2, holds: false }, // 4
  { depth: 2, holds: false }, // 5
  { depth: 1, holds: false }, // 6
  { depth: 1, holds: false }, // 7
  { depth: 0, holds: false }, // 8
  { depth: 0, holds: false }, // 9
];

/** Rows `height` high each, one after the other from 0; `tall` ones as high as given. */
const measured = (count: number, height: number, tall: Record<number, number> = {}) => {
  let start = 0;
  return Array.from({ length: count }, (_, at) => {
    const end = start + (tall[at] ?? height);
    const measure = { start, end };
    start = end;
    return measure;
  });
};

describe("the shape of rows", () => {
  it("knows each one's parent, and the last row within it", () => {
    const shape = shapeOf(TREE);
    expect([...shape.parent]).toEqual([-1, 0, 1, 1, 1, 1, 0, 0, -1, -1]);
    expect([...shape.last]).toEqual([7, 5, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe("rows stuck", () => {
  const shape = shapeOf(TREE);
  const rows = measured(10, 10);

  it("are those holding the row at the line, each below the one holding it", () => {
    expect(stuckRows(rows, shape, 25, () => 10)).toEqual([
      { index: 0, top: 0, height: 10 },
      { index: 1, top: 10, height: 10 },
    ]);
  });

  it("slide out as the end of what they hold reaches them, and those below them", () => {
    // inner ends at 60: at the line 47, its slot is 57 to 67, so it lies 50 to 60, under src.
    expect(stuckRows(rows, shape, 47, () => 10)).toEqual([
      { index: 0, top: 0, height: 10 },
      { index: 1, top: 3, height: 10 },
    ]);
    expect(stuckRows(rows, shape, 75, () => 10)).toEqual([{ index: 0, top: -5, height: 10 }]);
    expect(stuckRows(rows, shape, 81, () => 10)).toEqual([]);
  });

  it("include a row whose details are open, by its own height, until they pass", () => {
    const flat = shapeOf([
      { depth: 0, holds: false },
      { depth: 0, holds: true },
      { depth: 0, holds: false },
    ]);
    const tall = measured(3, 10, { 1: 100 }); // its row 10 high, its details 90
    expect(stuckRows(tall, flat, 50, () => 10)).toEqual([{ index: 1, top: 0, height: 10 }]);
    expect(stuckRows(tall, flat, 105, () => 10)).toEqual([{ index: 1, top: -5, height: 10 }]);
    expect(stuckRows(tall, flat, 5, () => 10)).toEqual([]);
  });

  it("are none in their place, not scrolled past the line", () => {
    expect(stuckRows(rows, shape, 0, () => 10)).toEqual([]);
    // Scrolled a pixel: src stuck at 1 to 11, over inner, at 10 to 20, which sticks below it.
    expect(stuckRows(rows, shape, 1, () => 10)).toEqual([
      { index: 0, top: 0, height: 10 },
      { index: 1, top: 10, height: 10 },
    ]);
  });

  it("start once a row itself passes the line, not what stands above it in its room", () => {
    const grouped = measured(10, 10, { 0: 19 }); // src 10 high, below a group's line of 9
    const below = (index: number) => (index === 0 ? 9 : 0);
    expect(stuckRows(grouped, shape, 5, () => 10, below)).toEqual([]);
    expect(stuckRows(grouped, shape, 10, () => 10, below)).toEqual([
      { index: 0, top: 0, height: 10 },
      { index: 1, top: 10, height: 10 }, // inner, from 19, a pixel under src
    ]);
  });

  it("lie at whole pixels from the line", () => {
    const fractional = measured(10, 18.84);
    expect(stuckRows(fractional, shape, 45, () => 18.84).map((row) => row.top)).toEqual([0, 19]);
  });
});

describe("the row at a point", () => {
  const rows = measured(5, 10);

  it("is the one whose room holds it", () => {
    expect(rowAt(rows, 0)).toBe(0);
    expect(rowAt(rows, 10)).toBe(1);
    expect(rowAt(rows, 49.9)).toBe(4);
  });

  it("is none beyond the rows", () => {
    expect(rowAt(rows, 50)).toBeUndefined();
    expect(rowAt([], 0)).toBeUndefined();
  });
});
