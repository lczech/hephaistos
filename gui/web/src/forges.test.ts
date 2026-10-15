import { describe, expect, it } from "vitest";
import { forgePage } from "./forges";

describe("a remote's page", () => {
  it("is on its forge, for the forges known", () => {
    expect(forgePage("github.com/me/proj")).toMatchObject({
      url: "https://github.com/me/proj",
      forge: "GitHub",
    });
    expect(forgePage("codeberg.org/me/proj")?.forge).toBe("Codeberg");
  });

  it("is unknown for local paths and other hosts, which may serve no pages", () => {
    expect(forgePage("/home/me/proj")).toBeUndefined();
    expect(forgePage("gaia/repos/proj")).toBeUndefined();
  });
});
