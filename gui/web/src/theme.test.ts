import { describe, expect, it } from "vitest";
import { schemeOf, showScheme } from "./theme";

describe("light or dark", () => {
  it("is as gui.theme chooses, else as the system is, also while the setting is unknown", () => {
    expect(schemeOf("light", "dark")).toBe("light");
    expect(schemeOf("dark", "light")).toBe("dark");
    expect(schemeOf("system", "dark")).toBe("dark");
    expect(schemeOf(undefined, "light")).toBe("light");
  });

  it("is said on the page's root, for the stylesheets", () => {
    showScheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    showScheme(); // the system's: jsdom says none, so light
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
