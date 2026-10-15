import { describe, expect, it } from "vitest";
import { FIRST, onScreen, savedBounds } from "./bounds.js";

describe("the window's bounds", () => {
  it("are those saved, if sound", () => {
    const saved = { width: 900, height: 700, x: 10, y: 20, maximized: true };
    expect(savedBounds(JSON.stringify(saved))).toEqual(saved);
    expect(savedBounds(JSON.stringify({ width: 900, height: 700 }))).toEqual({
      width: 900,
      height: 700,
      maximized: false,
    });
    expect(savedBounds(null)).toEqual(FIRST);
    expect(savedBounds("{")).toEqual(FIRST);
    expect(savedBounds(JSON.stringify({ width: 10, height: 700 }))).toEqual(FIRST);
  });

  it("lose a place that no screen shows any more", () => {
    const screen = { x: 0, y: 0, width: 1920, height: 1080 };
    const bounds = { width: 900, height: 700, x: 1800, y: 1000, maximized: false };
    expect(onScreen(bounds, [screen])).toEqual(bounds);
    expect(onScreen({ ...bounds, x: 2500 }, [screen])).toEqual({
      width: 900,
      height: 700,
      maximized: false,
    });
  });
});
