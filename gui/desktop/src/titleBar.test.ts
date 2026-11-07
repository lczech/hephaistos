import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buttonColours, TITLE_BAR_HEIGHT } from "./titleBar.js";

// The GUI's look, whose values the window's buttons repeat, as they show before the page.
const theme = readFileSync(new URL("../../web/src/theme.css", import.meta.url), "utf8");
const [light = "", dark = ""] = theme.split(':root[data-theme="dark"]');
const value = (part: string, name: string) => part.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1];

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

describe("the window's title bar", () => {
  it("is as high as the GUI's, and coloured as its bars and text are", () => {
    expect(value(light, "--title-bar-height")).toBe(`${TITLE_BAR_HEIGHT}px`);
    expect(buttonColours(null, false)).toEqual({
      color: value(light, "--bar"),
      symbolColor: value(light, "--text"),
    });
    expect(buttonColours(null, true)).toEqual({
      color: value(dark, "--bar"),
      symbolColor: value(dark, "--text"),
    });
  });
});
