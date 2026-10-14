import { describe, expect, it } from "vitest";
import { preciseTime } from "../../time";
import { cellText } from "./cells";

const AT = "2026-10-14T20:27:20.096+00:00";

describe("a cell", () => {
  it("shows values as `db dump` does, by their column's type", () => {
    expect(cellText(`${AT} #3`, "clock")).toBe(`${preciseTime(AT)} #3`);
    expect(cellText(AT, "time")).toBe(preciseTime(AT));
    expect(cellText({ origin: "git@host:x.git" }, "json")).toBe('{"origin":"git@host:x.git"}');
    expect(cellText(["main"], "json")).toBe('["main"]');
    expect(cellText(3, "plain")).toBe("3");
    expect(cellText("01a1…", "id")).toBe("01a1…");
    expect(cellText(null, "clock")).toBeNull();
  });

  it("shows what doesn't fit its type as it is", () => {
    expect(cellText("not a time #3", "clock")).toBe("not a time #3");
    expect(cellText("soon", "time")).toBe("soon");
    expect(cellText(`${AT} #3`, "plain")).toBe(`${AT} #3`);
  });
});
