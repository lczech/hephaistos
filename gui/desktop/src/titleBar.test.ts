import { describe, expect, it } from "vitest";
import { buttonColours } from "./titleBar.js";

describe("the window's buttons", () => {
  it("take the page's colour, their symbols set off against it", () => {
    expect(buttonColours("#f8f8f8", true)).toEqual({ color: "#f8f8f8", symbolColor: "#3b3b3b" });
    expect(buttonColours("#181818", false)).toEqual({ color: "#181818", symbolColor: "#cccccc" });
  });

  it("are the system's bar colour until the page says one it can read", () => {
    expect(buttonColours(null, true).color).toBe("#181818");
    expect(buttonColours(null, false).color).toBe("#f8f8f8");
    expect(buttonColours("color-mix(in srgb, red, blue)", false).color).toBe("#f8f8f8");
  });
});
