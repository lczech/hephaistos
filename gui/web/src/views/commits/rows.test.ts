import { describe, expect, it } from "vitest";
import { hueOf } from "../../hues";
import {
  branchOf,
  type Commit,
  type Entry,
  entries,
  graphOf,
  type Ref,
  shownRefs,
  tipsAt,
} from "./rows";

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

  it("gives no line the accent when the pinned one is not there, as asked", () => {
    const listed = entries([commit("f", ["b"], [ref("feature", "branch")]), commit("b", [])]);
    const { layout } = graphOf(listed, "f", { heads: new Set(["f"]), accent: "pinned" });
    expect(layout.rows.map((row) => row.colour.kind)).toEqual(["hue", "hue"]);
  });

  it("names no lane by a hidden branch, and labels no commit with it", () => {
    const refs = [ref("main", "branch"), ref("origin/up", "remote")];
    const listed = entries([commit("m", ["b"], refs), commit("b", [])]);
    const drawing = {
      heads: new Set<string>(),
      accent: "pinned" as const,
      hidden: new Set(["main"]),
    };
    const { layout } = graphOf(listed, "m", drawing);
    // named by the remote-tracking branch, shown
    expect(layout.rows[0]?.colour).toEqual({ kind: "hue", hue: hueOf("up"), muted: false });
    expect(shownRefs(refs, drawing).map((each) => each.name)).toEqual(["origin/up"]);
    expect(shownRefs(refs, undefined)).toBe(refs);
  });
});

describe("the tips of a graph's lines above a row", () => {
  // A Worktree's uncommitted changes above f, on feature; main pinned at m, which merged x.
  const checkout = { worktree: "wt-f" };
  const listed: Entry[] = [
    { type: "uncommitted", text: "Uncommitted in f", of: { checkout, head: "f", key: "wt" } },
    ...entries([
      commit("f", ["b"], [ref("feature", "branch")]),
      commit("m", ["b", "x"], [ref("main", "branch")]),
      commit("x", ["b"]),
      commit("b", ["a"]),
      commit("a", []),
    ]),
  ];
  const drawn = graphOf(listed, undefined, { heads: new Set(["f", "m"]), pinned: "m" });

  it("gives those with badges by lane, what is not committed by its HEAD's", () => {
    const { lines, tips } = tipsAt(drawn, 3, undefined); // x's row
    expect(lines.map((line) => [line.lane, line.start])).toEqual([
      [0, 2],
      [1, 0],
      [2, null], // opened by m's merge: a line alone
    ]);
    expect(tips.map(({ lane, row, id, node }) => ({ lane, row, id, node }))).toEqual([
      { lane: 0, row: 2, id: "m", node: "head" },
      { lane: 1, row: 0, id: "uncommitted:wt", node: "uncommitted" },
    ]);
    expect(tips.map((tip) => tip.commit.hash)).toEqual(["m", "f"]);
    expect(tips[0]?.colour).toEqual(drawn.layout.rows[2]?.colour);
  });

  it("adds the tip of the row coming in below, by its lane, if it starts a line", () => {
    // m's row below the uncommitted changes and f: m starts main's line.
    const { tips } = tipsAt(drawn, 1, undefined, 2);
    expect(tips.map(({ id, lane, coming }) => [id, lane, coming ?? false])).toEqual([
      ["m", 0, true],
      ["uncommitted:wt", 1, false],
    ]);
    // x's line was opened by m's merge: no tip of its own.
    expect(tipsAt(drawn, 2, undefined, 3).tips.map((tip) => tip.id)).toEqual([
      "m",
      "uncommitted:wt",
    ]);
  });

  it("marks those whose lines end in the row coming in below, which pushes them out", () => {
    // b, below x's row, takes main's line; feature's, from the uncommitted changes, ends there.
    const { tips } = tipsAt(drawn, 3, undefined, 4);
    expect(tips.map(({ id, leaving }) => [id, leaving ?? false])).toEqual([
      ["m", false],
      ["uncommitted:wt", true],
    ]);
    expect(tipsAt(drawn, 3, undefined).tips.some((tip) => tip.leaving)).toBe(false);
  });

  it("counts a tip once it is the row itself, and leaves out a line without badges", () => {
    expect(tipsAt(drawn, 0, undefined).tips.map((tip) => tip.id)).toEqual(["uncommitted:wt"]);
    const bare = graphOf(entries([commit("z", ["a"]), commit("a", [])]), undefined, {
      heads: new Set(),
    });
    const { lines, tips } = tipsAt(bare, 0, undefined);
    expect(lines.map((line) => line.lane)).toEqual([0]);
    expect(tips).toEqual([]);
    // History's HEAD, though without refs, has its badge.
    expect(tipsAt(bare, 0, "z").tips.map((tip) => tip.id)).toEqual(["z"]);
  });
});
