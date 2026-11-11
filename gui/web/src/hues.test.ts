import { describe, expect, it } from "vitest";
import { hueColour, hueOf } from "./hues";

describe("hues", () => {
  it("gives a name the same hue every time, within a circle", () => {
    for (const name of ["main", "feature/graph", "", "ü-ñ", "a".repeat(500)]) {
      const hue = hueOf(name);
      expect(hue).toBe(hueOf(name));
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });

  it("spreads similar names around the circle", () => {
    const names = Array.from({ length: 200 }, (_, i) => `feature-${i}`);
    const hues = names.map(hueOf);
    expect(new Set(hues).size).toBeGreaterThan(190); // nearly all apart
    const quarters = [0, 1, 2, 3].map((q) => hues.filter((h) => Math.floor(h / 90) === q).length);
    for (const count of quarters) expect(count).toBeGreaterThan(30); // none left empty
    expect(Math.abs(hueOf("lczech/git-graph") - hueOf("lczech/git-graph2"))).toBeGreaterThan(1);
  });

  it("writes the colour with the theme's lightness and chroma, muted or not", () => {
    expect(hueColour(120)).toBe("oklch(var(--hue-lightness) var(--hue-chroma) 120)");
    expect(hueColour(12.5, true)).toBe("oklch(var(--hue-lightness) var(--hue-chroma-muted) 12.5)");
  });
});
