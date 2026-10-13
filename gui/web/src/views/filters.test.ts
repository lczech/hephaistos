import { describe, expect, it } from "vitest";
import { columnFilters, filteredParams } from "./filters";

const columns = [
  { id: "recorded", meta: { filter: { param: "since" } } },
  { id: "kind", meta: { filter: { param: "kind", many: "kinds" } } },
  { id: "summary" },
];

describe("a list's column filters", () => {
  it("are the View's parameters, in the columns' order", () => {
    expect(columnFilters(columns, { kind: "clone", since: "1d", worktree: "01" })).toEqual([
      { id: "recorded", value: ["1d"] },
      { id: "kind", value: ["clone"] },
    ]);
    expect(columnFilters(columns, {})).toEqual([]);
  });

  it("become parameters again, beside those that aren't filters", () => {
    const params = { kind: "clone", since: "1d", worktree: "01" };
    const filters = [{ id: "kind", value: ["clone", "worktree"] }];
    expect(filteredParams(columns, params, filters)).toEqual({
      kind: ["clone", "worktree"],
      worktree: "01",
    });
    expect(filteredParams(columns, params, [])).toEqual({ worktree: "01" });
  });
});
