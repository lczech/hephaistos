import { describe, expect, it } from "vitest";
import {
  atLeast,
  capitalised,
  counted,
  listText,
  nameOrId,
  numberText,
  plural,
  shortId,
  sizeText,
} from "./text";

describe("text", () => {
  it("capitalises the first letter alone", () => {
    expect(capitalised("uncommitted changes")).toBe("Uncommitted changes");
    expect(capitalised("")).toBe("");
  });

  it("writes numbers with their thousands apart, and a + for more", () => {
    expect(numberText(1234567)).toBe("1,234,567");
    expect(atLeast(12, false)).toBe("12");
    expect(atLeast(1200, true)).toBe("1,200+");
  });

  it("counts things, singular for one alone", () => {
    expect(counted(1, "file")).toBe("1 file");
    expect(counted(0, "file")).toBe("0 files");
    expect(counted(1234, "new folder")).toBe("1,234 new folders");
    expect(counted(1, "file", true)).toBe("1+ files");
    expect(plural(1, "parent")).toBe("parent");
    expect(plural(2, "parent")).toBe("parents");
  });

  it("lists words as a sentence does", () => {
    expect(listText([])).toBe("");
    expect(listText(["row"])).toBe("row");
    expect(listText(["row", "view"])).toBe("row and view");
    expect(listText(["a", "b", "c"])).toBe("a, b and c");
  });

  it("shows an ID by its end, as the CLI does, where there is no name", () => {
    expect(shortId("0199e000-0000-7000-8000-0000deadbeef")).toBe("deadbeef");
    expect(nameOrId({ name: null, id: "0199e000-0000-7000-8000-0000deadbeef" })).toBe("deadbeef");
    expect(nameOrId({ name: "gaia", id: "0199e000-0000-7000-8000-0000deadbeef" })).toBe("gaia");
  });
});

describe("sizeText", () => {
  it("gives sizes in bytes, kB, MB", () => {
    expect([512, 3400, 12_345, 1_200_000, 5e9].map(sizeText)).toEqual([
      "512 B",
      "3.4 kB",
      "12 kB",
      "1.2 MB",
      "5.0 GB",
    ]);
  });
});
