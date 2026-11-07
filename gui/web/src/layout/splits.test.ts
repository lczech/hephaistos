import { describe, expect, it } from "vitest";
import { type GridNode, nodeAt, ownGroups, partHandles, sideBySide } from "./splits";

const leaf = (id: string): GridNode => ({ type: "leaf", data: { id } });
const branch = (...data: GridNode[]): GridNode => ({ type: "branch", data });

// A wide Group on top of three side by side, beside two rows of two.
const wideTop = branch(leaf("A"), branch(leaf("B"), leaf("C"), leaf("D")));
const rows = branch(branch(leaf("E"), leaf("F")), branch(leaf("G"), leaf("H")));
const root = branch(wideTop, rows);

describe("a split of the grid", () => {
  it("is found by its parts' indexes down from the top", () => {
    expect(nodeAt(root, [])).toBe(root);
    expect(nodeAt(root, [0, 1])).toEqual(branch(leaf("B"), leaf("C"), leaf("D")));
    expect(nodeAt(root, [0, 0])).toEqual(leaf("A"));
    expect(nodeAt(root, [0, 0, 0])).toBeUndefined();
    expect(nodeAt(root, [5])).toBeUndefined();
  });

  it("lays its parts out the top's way, every other split", () => {
    expect([0, 1, 2].map((depth) => sideBySide("HORIZONTAL", depth))).toEqual([true, false, true]);
    expect([0, 1, 2].map((depth) => sideBySide("VERTICAL", depth))).toEqual([false, true, false]);
  });

  it("has Groups of its own, and one for each part but the last to size it by", () => {
    expect(ownGroups(wideTop)).toEqual(["A"]);
    expect(ownGroups(rows)).toEqual([]);
    expect(partHandles(wideTop)).toEqual(["A"]);
    expect(partHandles(rows)).toEqual(["E"]);
    expect(partHandles(branch(branch(rows, leaf("I")), leaf("J")))).toEqual(["I"]);
    expect(partHandles(branch(rows, leaf("J")))).toEqual([undefined]);
  });
});
