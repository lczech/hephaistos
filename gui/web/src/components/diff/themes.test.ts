import { describe, expect, it } from "vitest";
import { codeThemes, DEFAULT_THEMES } from "./themes";

describe("code themes", () => {
  it("are those named, if known, else the defaults", () => {
    expect(codeThemes({ light: "solarized-light", dark: "dark-plus" })).toEqual([
      { light: "solarized-light", dark: "dark-plus" },
      [],
    ]);
    expect(codeThemes({ light: "nope" })).toEqual([DEFAULT_THEMES, ["nope"]]);
  });
});
