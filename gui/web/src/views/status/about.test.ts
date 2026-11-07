import { describe, expect, it } from "vitest";
import { shellText } from "./about";

describe("what shows the GUI", () => {
  it("is Electron with its Chromium, else the browser as it says", () => {
    const electron =
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) hephaistos/0.1.0" +
      " Chrome/140.0.7339.41 Electron/44.7.2 Safari/537.36";
    expect(shellText(electron)).toBe("Electron 44.7.2, Chromium 140.0.7339.41");
    const firefox = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";
    expect(shellText(firefox)).toBe(firefox);
  });
});
