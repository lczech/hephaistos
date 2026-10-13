import { describe, expect, it } from "vitest";
import { shortPath } from "./paths";

describe("shortPath", () => {
  it("shows the home directory as ~", () => {
    expect(shortPath("/home/me", "/home/me")).toBe("~");
    expect(shortPath("/home/me/Repos/x", "/home/me")).toBe("~/Repos/x");
  });

  it("leaves other paths, and look-alikes, as they are", () => {
    expect(shortPath("/home/meadow/x", "/home/me")).toBe("/home/meadow/x");
    expect(shortPath("/srv/x", "/home/me")).toBe("/srv/x");
    expect(shortPath("/home/me/x", undefined)).toBe("/home/me/x");
  });
});
