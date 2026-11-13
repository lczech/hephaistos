import { describe, expect, it } from "vitest";
import { hueOf } from "../../hues";
import {
  branchOf,
  branchThrough,
  type CheckedOut,
  type Commit,
  type Drawing,
  type Entry,
  entries,
  graphOf,
  type Ref,
  shownRefs,
  tipsAt,
  tipsEntries,
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

  it("colours the lane of a branch by its name, below the first", () => {
    const listed = entries([
      commit("m", ["b", "t"]),
      commit("t", ["b"], [ref("topic", "branch")]),
      commit("b", []),
    ]);
    const { layout } = graphOf(listed, "m", { heads: new Set(["m"]) });
    // t is awaited by the lane of the merge, which no branch names: muted, by the commit it
    // leads to.
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

describe("the colour of a line as commits are made on it", () => {
  // A Worktree on feature at f, and one detached at d; no line in the accent, none pinned.
  const checkedOut: CheckedOut[] = [
    { name: "f", path: "/f", worktree: true, branch: "feature", commit: "f" },
    { name: "d", path: "/d", worktree: true, branch: null, commit: "d" },
  ];
  const drawing: Drawing = { heads: new Set(["f", "d"]), accent: "pinned", checkedOut };
  const uncommitted = (head: string, key: string): Entry => ({
    type: "uncommitted",
    text: "Uncommitted",
    of: { checkout: { worktree: key }, head, key },
  });
  const base = [commit("b", [])];
  const colours = (listed: Entry[], ...ids: string[]) => {
    const { layout, rows } = graphOf(listed, undefined, drawing);
    return ids.map((id) => layout.rows[rows.get(id) ?? -1]?.colour);
  };

  it("keeps that of its branch while what is not committed is above it, and after", () => {
    const feature = { kind: "hue", hue: hueOf("feature"), muted: false };
    const before = [
      uncommitted("f", "/f"),
      ...entries([commit("f", ["b"], [ref("feature", "branch")]), ...base]),
    ];
    expect(colours(before, "uncommitted:/f", "f")).toEqual([feature, feature]);
    const after = entries([
      commit("g", ["f"], [ref("feature", "branch")]),
      commit("f", ["b"]),
      ...base,
    ]);
    expect(colours(after, "g", "f")).toEqual([feature, feature]);
  });

  it("colours the line of a detached Checkout by its name, muted, as it moves", () => {
    const detached = { kind: "hue", hue: hueOf("d"), muted: true };
    const before = [uncommitted("d", "/d"), ...entries([commit("d", ["b"]), ...base])];
    expect(colours(before, "uncommitted:/d", "d")).toEqual([detached, detached]);
    const moved = { ...drawing, checkedOut: [{ ...(checkedOut[1] as CheckedOut), commit: "e" }] };
    const after = graphOf(
      entries([commit("e", ["d"]), commit("d", ["b"]), ...base]),
      undefined,
      moved,
    );
    expect(after.layout.rows[0]?.colour).toEqual(detached);
  });
});

describe("the tips of a graph's lines above a row", () => {
  // The uncommitted changes of a Worktree above f, on feature; main pinned at m, which merged x.
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
    const { lines, tips } = tipsAt(drawn, 3, undefined); // the row of x
    expect(lines.map((line) => [line.lane, line.start])).toEqual([
      [0, 2],
      [1, 0],
      [2, null], // opened by the merge m: a line alone
    ]);
    expect(tips.map(({ lane, row, id, node }) => ({ lane, row, id, node }))).toEqual([
      { lane: 0, row: 2, id: "m", node: "head" },
      { lane: 1, row: 0, id: "uncommitted:wt", node: "uncommitted" },
    ]);
    expect(tips.map((tip) => tip.commit.hash)).toEqual(["m", "f"]);
    expect(tips[0]?.colour).toEqual(drawn.layout.rows[2]?.colour);
  });

  it("adds the tip of the row coming in below, by its lane, if it starts a line", () => {
    // The row of m below the uncommitted changes and f: m starts the line of main.
    const { tips } = tipsAt(drawn, 1, undefined, 2);
    expect(tips.map(({ id, lane, coming }) => [id, lane, coming ?? false])).toEqual([
      ["m", 0, true],
      ["uncommitted:wt", 1, false],
    ]);
    // The line of x was opened by the merge m: no tip of its own.
    expect(tipsAt(drawn, 2, undefined, 3).tips.map((tip) => tip.id)).toEqual([
      "m",
      "uncommitted:wt",
    ]);
  });

  it("marks those whose lines end in the row coming in below, which pushes them out", () => {
    // b, below the row of x, takes the line of main; that of feature, from the uncommitted changes,
    // ends there.
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
    // The HEAD of History, though without refs, has its badge.
    expect(tipsAt(bare, 0, "z").tips.map((tip) => tip.id)).toEqual(["z"]);
  });

  it("gives the same tips, a row on, with a commit added on top, as pages load anew", () => {
    const [first, ...rest] = listed;
    const added = graphOf([first as Entry, ...entries([commit("n", ["f"])]), ...rest], undefined, {
      heads: new Set(["f", "m"]),
      pinned: "m",
    });
    // n above f: below the row of x, a row lower now, the same lines and tips, by the same IDs.
    const before = tipsAt(drawn, 3, undefined);
    const after = tipsAt(added, 4, undefined);
    expect(after.tips.map((tip) => tip.id)).toEqual(before.tips.map((tip) => tip.id));
    expect(after.lines.map((line) => line.lane)).toEqual(before.lines.map((line) => line.lane));
  });

  it("keeps a line waiting for a parent not listed, e.g. a page missed, its tip still there", () => {
    const gap = graphOf(
      entries([commit("t", ["p"], [ref("topic", "branch")]), commit("m", ["b"]), commit("b", [])]),
      undefined,
      { heads: new Set() },
    );
    const { lines, tips } = tipsAt(gap, 2, undefined);
    expect(lines.map((line) => [line.lane, line.start])).toEqual([[0, 0]]); // that of t, waiting on
    expect(tips.map((tip) => tip.id)).toEqual(["t"]);
  });
});

describe("a graph of branch tips only", () => {
  // feature (f) merged into main (m) where it was then (g), and gone on; base (b) below both,
  // the first commit (r) its parent. Real parents are those hidden: f1, m1, b1.
  const kept = [
    commit("f", ["f1"], [ref("feature", "branch")]),
    commit("m", ["m1", "g"], [ref("main", "branch")]),
    commit("g", ["g1"]),
    commit("b", ["r"]),
    commit("r", []),
  ];
  const line = (from: string, to: string, count: number) => ({
    commit: from,
    parent: to,
    count,
    newest: count ? "2026-10-02T00:00:00Z" : null,
    oldest: count ? "2026-10-01T00:00:00Z" : null,
  });
  const lines = [
    line("f", "g", 2),
    line("m", "b", 3),
    line("m", "g", 0),
    line("g", "b", 1),
    line("b", "r", 0),
  ];

  it("gives the commits left out on a line a row below its commit, drawn through it", () => {
    const { entries: rows, parents } = tipsEntries(kept, lines);
    expect(rows.map(entryIdOf)).toEqual([
      "f",
      "stretch:f",
      "m",
      "stretch:m",
      "g",
      "stretch:g",
      "b",
      "r",
    ]);
    expect(rows[1]).toEqual({ type: "stretch", ...line("f", "g", 2) });
    expect(Object.fromEntries(parents)).toEqual({
      f: ["stretch:f"],
      m: ["stretch:m", "g"],
      g: ["stretch:g"],
      b: ["r"],
      r: [],
    });
    const drawn = graphOf(rows, null, { heads: new Set(), parents });
    expect(drawn.layout.rows.map((row) => row.node)).toEqual([
      "commit",
      "stretch",
      "merge",
      "stretch",
      "commit",
      "stretch",
      "commit",
      "commit",
    ]);
    // Each stretch on the lane of its commit, coming in from it.
    const lanes = drawn.layout.rows.map((row) => row.lane);
    expect([lanes[1], lanes[3], lanes[5]]).toEqual([lanes[0], lanes[2], lanes[4]]);
    expect(drawn.layout.rows[1]?.above).not.toBeNull();
    // Named by the branch at the tip of its line; none for a line a merge opened.
    expect(branchThrough(drawn, 1)).toBe("feature");
    expect(branchThrough(drawn, 3)).toBe("main");
  });

  it("names the line of a stretch by its branch where what is not committed starts it", () => {
    const { entries: rows, parents } = tipsEntries(kept, lines);
    const uncommitted: Entry = {
      type: "uncommitted",
      text: "Uncommitted",
      of: { checkout: { clone: "c" }, head: "m", key: "/m" },
    };
    const drawn = graphOf([...rows.slice(0, 2), uncommitted, ...rows.slice(2)], null, {
      heads: new Set(["m"]),
      parents,
    });
    const at = drawn.rows.get("stretch:m") ?? -1;
    expect(drawn.layout.rows[at]?.start).toBe(drawn.rows.get("uncommitted:/m"));
    expect(branchThrough(drawn, at)).toBe("main");
  });

  it("draws a merge with only its first parent where its sides are not drawn", () => {
    const { entries: rows, parents } = tipsEntries(
      [commit("m", ["m1", "t"]), commit("r", [])],
      [line("m", "r", 4)],
    );
    const drawn = graphOf(rows, null, { heads: new Set(), parents });
    expect(drawn.layout.rows.map((row) => row.node)).toEqual(["commit", "stretch", "commit"]);
  });
});

const entryIdOf = (entry: Entry) =>
  entry.type === "commit"
    ? entry.commit.hash
    : entry.type === "stretch"
      ? `stretch:${entry.commit}`
      : entry.type;
