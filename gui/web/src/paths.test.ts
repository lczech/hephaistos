import { describe, expect, it } from "vitest";
import { pathParts, shortPath } from "./paths";

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

describe("pathParts", () => {
  it("parts a path into its folder and name; a folder's name ends in /", () => {
    expect(pathParts("src/views/rows.ts")).toEqual(["src/views/", "rows.ts"]);
    expect(pathParts("README.md")).toEqual(["", "README.md"]);
    expect(pathParts("new/")).toEqual(["", "new/"]);
    expect(pathParts("src/new/")).toEqual(["src/", "new/"]);
  });
});
