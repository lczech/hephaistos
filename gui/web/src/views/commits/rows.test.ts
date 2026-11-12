import { describe, expect, it } from "vitest";
import { hueOf } from "../../hues";
import { branchOf, type Commit, type Entry, entries, graphOf, type Ref } from "./rows";

const person = { name: "L", email: "l@example.org", at: "2026-01-01T00:00:00Z" };
const ref = (name: string, kind: Ref["kind"]): Ref => ({ name, full: name, kind, commit: "" });
const commit = (hash: string, parents: string[], refs: Ref[] = []): Commit => ({
  hash,
  parents,
  subject: hash,
  body: "",
  author: person,
  committer: person,
  refs,
  renamed_from: null,
});

describe("the graph of a list of commits", () => {
  it("names a lane by a local branch first, else a remote one without its remote", () => {
    expect(branchOf([ref("v1", "tag"), ref("origin/x", "remote"), ref("main", "branch")])).toBe(
      "main",
    );
    expect(branchOf([ref("origin/feature/y", "remote")])).toBe("feature/y");
    expect(branchOf([ref("v1", "tag")])).toBeUndefined();
    expect(branchOf([])).toBeUndefined();
  });

  it("gives a row to each commit and to what is not committed, above HEAD", () => {
    const listed: Entry[] = [
      { type: "uncommitted", text: "Uncommitted: 1 changed" },
      ...entries([commit("h", ["s"], [ref("main", "branch")]), commit("s", [])]),
    ];
    const { layout, rows } = graphOf(listed, "h", { heads: new Set(["h"]) });
    expect([...rows.entries()]).toEqual([
      ["uncommitted", 0],
      ["h", 1],
      ["s", 2],
    ]);
    expect(layout.rows.map((row) => row.node)).toEqual(["uncommitted", "head", "commit"]);
    expect(layout.rows.every((row) => row.colour.kind === "accent")).toBe(true);
  });

  it("leaves out rows it cannot draw: what is not committed without HEAD, renames, finds", () => {
    const listed: Entry[] = [
      { type: "uncommitted", text: "Uncommitted: 1 changed" },
      { type: "renamed", commit: "a", from: "old.ts" },
      ...entries([commit("a", [], [ref("topic", "branch")])]),
    ];
    const { layout, rows } = graphOf(listed, null, { heads: new Set() });
    expect([...rows.keys()]).toEqual(["a"]);
    expect(layout.rows).toHaveLength(1);
  });

  it("colours a branch's lane by its name, below the first", () => {
    const listed = entries([
      commit("m", ["b", "t"]),
      commit("t", ["b"], [ref("topic", "branch")]),
      commit("b", []),
    ]);
    const { layout } = graphOf(listed, "m", { heads: new Set(["m"]) });
    // t is awaited by the merge's lane, which no branch names: muted, by the commit it leads to.
    expect(layout.rows[1]?.colour).toEqual({ kind: "hue", hue: hueOf("t"), muted: true });
    const tip = graphOf(
      entries([commit("x", ["b"]), commit("t", ["b"], [ref("topic", "branch")]), commit("b", [])]),
      "x",
      { heads: new Set(["x"]) },
    );
    expect(tip.layout.rows[1]?.colour).toEqual({ kind: "hue", hue: hueOf("topic"), muted: false });
  });
});

describe("a graph with a pinned branch", () => {
  it("keeps the pinned commit's line in lane 0 and the accent, HEADs drawn larger", () => {
    const listed = entries([
      commit("f", ["b"], [ref("feature", "branch")]),
      commit("m", ["b"], [ref("main", "branch")]),
      commit("b", []),
    ]);
    const { layout } = graphOf(listed, "f", { heads: new Set(["f", "m"]), pinned: "m" });
    expect(layout.rows.map((row) => row.lane)).toEqual([1, 0, 0]);
    expect(layout.rows[1]?.colour).toEqual({ kind: "accent" });
    expect(layout.rows[0]?.colour).toEqual({ kind: "hue", hue: hueOf("feature"), muted: false });
    expect(layout.rows.map((row) => row.node)).toEqual(["head", "head", "commit"]);
  });
});
