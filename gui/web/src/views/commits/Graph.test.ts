import { describe, expect, it } from "vitest";
import { fittedWidth } from "./Graph";

describe("the graph column", () => {
  it("fits the lanes loaded, at least one, at most eight", () => {
    expect(fittedWidth(0)).toBe(fittedWidth(1));
    expect(fittedWidth(1)).toBe(18); // a lane and half of one
    expect(fittedWidth(3)).toBe(42);
    expect(fittedWidth(20)).toBe(fittedWidth(8));
  });
});
