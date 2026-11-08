import { describe, expect, it } from "vitest";
import { arrange, columnCount, deal, type GroupTabs, readingOrder } from "./columns";
import type { GridNode } from "./splits";

const leaf = (id: string): GridNode => ({ type: "leaf", data: { id } });
const branch = (...data: GridNode[]): GridNode => ({ type: "branch", data });

describe("dealing tabs into columns", () => {
  const tabs = ["a", "b", "c", "d", "e"];

  it("cuts them in order into runs differing by one at most, the longer first", () => {
    expect(deal(tabs, 1)).toEqual([tabs]);
    expect(deal(tabs, 2)).toEqual([
      ["a", "b", "c"],
      ["d", "e"],
    ]);
    expect(deal(tabs, 3)).toEqual([["a", "b"], ["c", "d"], ["e"]]);
    expect(deal(tabs, 4)).toEqual([["a", "b"], ["c"], ["d"], ["e"]]);
  });

  it("leaves the last runs empty with fewer tabs than columns, or none", () => {
    expect(deal(["a", "b"], 4)).toEqual([["a"], ["b"], [], []]);
    expect(deal([], 3)).toEqual([[], [], []]);
  });

  it("gives the same runs again, from any count to any other and back", () => {
    const many = Array.from({ length: 7 }, (_, at) => `t${at}`);
    for (const from of [1, 2, 3, 4]) {
      for (const to of [1, 2, 3, 4]) {
        expect(deal(deal(deal(many, from).flat(), to).flat(), from)).toEqual(deal(many, from));
      }
    }
  });
});

describe("the grid's columns", () => {
  // A wide Group on top of three side by side: one column of rows.
  const wideTop = branch(leaf("A"), branch(leaf("B"), leaf("C"), leaf("D")));

  it("reads the Groups left to right and top to bottom, within splits as without", () => {
    expect(readingOrder(wideTop)).toEqual(["A", "B", "C", "D"]);
    expect(readingOrder(branch(branch(leaf("A"), leaf("B")), leaf("C")))).toEqual(["A", "B", "C"]);
  });

  it("counts only those at the top, side by side; rows within them do not count", () => {
    expect(columnCount({ root: wideTop, orientation: "VERTICAL" })).toBe(1);
    const rows = branch(branch(leaf("A"), leaf("B")), leaf("C"));
    expect(columnCount({ root: rows, orientation: "HORIZONTAL" })).toBe(2);
    expect(columnCount({ root: branch(leaf("A")), orientation: "VERTICAL" })).toBe(1);
    expect(columnCount({ root: leaf("A"), orientation: "HORIZONTAL" })).toBe(1);
  });
});

describe("arranging Groups into columns", () => {
  const group = (id: string, panels: string[], shown = panels[0]): GroupTabs => ({
    id,
    panels,
    shown,
  });

  it("deals the tabs in reading order, each run reusing its first tab's Group", () => {
    const groups = [group("1", ["a", "b", "c"], "b"), group("2", ["d", "e"], "e")];
    expect(arrange(groups, 3)).toEqual([
      { group: "1", panels: ["a", "b"], shown: "b" },
      { group: null, panels: ["c", "d"], shown: "c" }, // its first tab's Group is taken
      { group: "2", panels: ["e"], shown: "e" },
    ]);
  });

  it("merges Groups, showing the first tab of a run that was shown", () => {
    const groups = [group("1", ["a"]), group("2", ["b", "c"], "c"), group("3", ["d"])];
    expect(arrange(groups, 1)).toEqual([{ group: "1", panels: ["a", "b", "c", "d"], shown: "a" }]);
    expect(arrange(groups, 2)).toEqual([
      { group: "1", panels: ["a", "b"], shown: "a" },
      { group: "2", panels: ["c", "d"], shown: "c" },
    ]);
  });

  it("makes new, empty Groups past the tabs, and drops empty Groups", () => {
    const groups = [group("1", ["a"]), group("2", []), group("3", ["b"])];
    expect(arrange(groups, 4)).toEqual([
      { group: "1", panels: ["a"], shown: "a" },
      { group: "3", panels: ["b"], shown: "b" },
      { group: null, panels: [], shown: undefined },
      { group: null, panels: [], shown: undefined },
    ]);
  });
});
