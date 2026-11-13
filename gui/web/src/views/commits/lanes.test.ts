import { describe, expect, it } from "vitest";
import { hueOf } from "../../hues";
import { type GraphNode, Layout, type LayoutOptions, type Line, type RowGraph } from "./lanes";

const n = (hash: string, ...parents: string[]): GraphNode => ({ hash, parents });
const lay = (nodes: GraphNode[], options: LayoutOptions = {}) => {
  const layout = new Layout(options);
  const rows = nodes.map((node) => layout.add(node));
  return { layout, rows };
};
const lanesOf = (rows: RowGraph[]) => rows.map((row) => row.lane);
const tos = (row: RowGraph | undefined) => row?.out.map((bend) => bend.to);
const froms = (row: RowGraph | undefined) => row?.into.map((bend) => bend.from);
const columns = (lines: Line[]) => lines.map((line) => line.lane);

describe("lanes", () => {
  it("keeps a line of commits in lane 0, each coming from the one above", () => {
    const { rows } = lay([n("c", "b"), n("b", "a"), n("a")]);
    expect(lanesOf(rows)).toEqual([0, 0, 0]);
    expect(rows.map((row) => row.above !== null)).toEqual([false, true, true]);
    expect(rows[2]?.out).toEqual([]);
    expect(rows.map((row) => row.width)).toEqual([1, 1, 1]);
  });

  it("joins a branch to the pinned line at the commit it left from", () => {
    // f is on a branch off b; m, pinned, is master.
    const { rows, layout } = lay([n("f", "b"), n("m", "b"), n("b", "a"), n("a")], {
      pinned: "m",
    });
    expect(lanesOf(rows)).toEqual([1, 0, 0, 0]);
    expect(rows[0]?.above).toBeNull();
    expect(layout.passing(0)).toEqual([]); // the pinned lane is not drawn above its commit
    expect(rows[1]?.above).toBeNull();
    expect(froms(rows[2])).toEqual([1]);
    expect(columns(layout.passing(1))).toEqual([1]);
  });

  it("gives lane 0 to the first commit listed, without a pinned one", () => {
    const { rows } = lay([n("f", "b"), n("m", "b"), n("b")]);
    expect(lanesOf(rows)).toEqual([0, 1, 0]);
  });

  it("sends a merge's second parent to a new lane, which ends at it", () => {
    const { rows, layout } = lay([n("m", "b", "f"), n("f", "a"), n("b", "a"), n("a")], {
      pinned: "m",
    });
    expect(tos(rows[0])).toEqual([0, 1]);
    expect(lanesOf(rows)).toEqual([0, 1, 0, 0]);
    expect(columns(layout.passing(2))).toEqual([1]);
    expect(froms(rows[3])).toEqual([1]);
    expect(layout.below(3)).toEqual([]); // no lane left open
  });

  it("opens a lane per parent of an octopus merge", () => {
    const { rows } = lay([n("m", "a", "b", "c"), n("c", "a"), n("b", "a"), n("a")]);
    expect(tos(rows[0])).toEqual([0, 1, 2]);
    expect(froms(rows[3])).toEqual([1, 2]);
    expect(rows[0]?.width).toBe(3);
  });

  it("sends a merge's parent to the lane already waiting for it", () => {
    // x waits for b in lane 0; m merges b too.
    const { rows } = lay([n("x", "b"), n("m", "a", "b"), n("b", "a"), n("a")]);
    expect(tos(rows[1])).toEqual([1, 0]);
  });

  it("does not reuse a column ending in a node for its merge parent", () => {
    // b ends lanes 0 and 1; its second parent must not start in lane 1 below it.
    const { rows } = lay([n("x", "b"), n("y", "b"), n("b", "a", "c"), n("c"), n("a")]);
    expect(froms(rows[2])).toEqual([1]);
    expect(tos(rows[2])).toEqual([0, 2]);
  });

  it("keeps the row of the tip each line starts at, none for a line a merge opened", () => {
    // f and m are tips; m merges x, whose line m opened; b takes f's lane, the leftmost.
    const { rows, layout } = lay([n("f", "b"), n("m", "b", "x"), n("x", "b"), n("b", "a"), n("a")]);
    expect(rows.map((row) => row.start)).toEqual([0, 1, null, 0, 0]);
    expect(rows[1]?.out.map((bend) => bend.start)).toEqual([1, null]);
    expect(layout.below(2).map((line) => [line.lane, line.start])).toEqual([
      [0, 0],
      [1, 1],
      [2, null],
    ]);
    expect(rows[3]?.into.map((bend) => bend.start)).toEqual([1, null]); // ending in b
  });

  it("reuses the leftmost free column for a new lane", () => {
    const { rows } = lay([n("x", "a"), n("y", "a"), n("a"), n("z", "w"), n("w")]);
    expect(lanesOf(rows)).toEqual([0, 1, 0, 0, 0]);
  });

  it("leads the pinned lane from the uncommitted changes on the pinned commit, dashed", () => {
    const wt = { ...n("wt", "m"), uncommitted: true };
    const { rows } = lay([n("f", "m"), wt, n("m", "a"), n("a")], { pinned: "m" });
    expect(lanesOf(rows)).toEqual([1, 0, 0, 0]);
    expect(rows[1]?.node).toBe("uncommitted");
    expect(rows[1]?.out).toEqual([
      { from: 0, to: 0, colour: rows[1]?.colour, dashed: true, start: 1 }, // its line starts here
    ]);
    expect(rows[2]?.above?.dashed).toBe(true);
    expect(rows[3]?.above?.dashed).toBe(false);
  });

  it("starts a lane above HEAD for its uncommitted changes, without a pinned commit", () => {
    const wt = { ...n("wt", "h"), uncommitted: true };
    const { rows } = lay([wt, n("h", "a"), n("a")], { heads: new Set(["h"]), accent: "first" });
    expect(lanesOf(rows)).toEqual([0, 0, 0]);
    expect(rows.map((row) => row.node)).toEqual(["uncommitted", "head", "commit"]);
    expect(rows[1]?.above?.dashed).toBe(true);
    expect(rows.every((row) => row.colour.kind === "accent")).toBe(true);
  });

  it("lays out pages appended as it does all at once", () => {
    const nodes = [n("x", "b"), n("m", "a", "b"), n("b", "a"), n("q", "a"), n("a", "r"), n("r")];
    const whole = lay(nodes, { pinned: "m" });
    const paged = new Layout({ pinned: "m" });
    const first = nodes.slice(0, 2).map((node) => paged.add(node));
    const drawn = paged.passing(1); // a page drawn before the next comes
    const rest = nodes.slice(2).map((node) => paged.add(node));
    expect([...first, ...rest]).toEqual(whole.rows);
    expect(paged.passing(1)).toEqual(drawn);
    for (let row = 0; row < nodes.length; row++) {
      expect(paged.passing(row)).toEqual(whole.layout.passing(row));
    }
  });

  it("keeps lanes open for parents not listed yet, passing every row below", () => {
    const { layout } = lay([n("m", "a", "z"), n("a", "y"), n("p")]);
    expect(columns(layout.below(2))).toEqual([0, 1]); // a's to y, m's second to z
    expect(columns(layout.passing(2))).toEqual([0, 1]);
  });

  it("draws no line to a parent listed before its child, as with clocks apart", () => {
    // git's default order may list a's parent r before a child of r that came later.
    const { rows, layout } = lay([n("a", "r"), n("r"), n("late", "r")]);
    expect(rows[2]?.out).toEqual([]);
    expect(layout.below(2)).toEqual([]); // no lane left open
    const merge = lay([n("a", "r"), n("r"), n("m", "r", "s"), n("s")]);
    expect(tos(merge.rows[2])).toEqual([0]); // only the parent still to come
    expect(merge.layout.below(3)).toEqual([]);
  });

  it("colours lane 0 in the accent, branches by their names, others muted", () => {
    const nodes = [
      { ...n("h", "a", "s"), branch: "main" },
      { ...n("f", "a"), branch: "feature" },
      n("s", "a"),
      n("a"),
    ];
    const { rows } = lay(nodes, { accent: "first" });
    expect(rows[0]?.colour).toEqual({ kind: "accent" });
    expect(rows[1]?.colour).toEqual({ kind: "hue", hue: hueOf("feature"), muted: false });
    expect(rows[2]?.colour).toEqual({ kind: "hue", hue: hueOf("s"), muted: true });
    const pinned = lay([n("f", "m"), n("m")], { pinned: "m", accent: "pinned" });
    expect(pinned.rows[1]?.colour).toEqual({ kind: "accent" });
    expect(pinned.rows[0]?.colour.kind).toBe("hue");
  });

  it("names the kinds of nodes: HEAD, merges, commits", () => {
    const { rows } = lay([n("m", "a", "b"), n("b", "a"), n("a")], { heads: new Set(["b"]) });
    expect(rows.map((row) => row.node)).toEqual(["merge", "head", "commit"]);
  });

  it("finds below a row the lanes passing it and those leaving its node", () => {
    const { layout } = lay([n("x", "b"), n("m", "a", "b"), n("b", "a"), n("a")]);
    expect(columns(layout.below(1))).toEqual([0, 1]);
    expect(columns(layout.below(3))).toEqual([]);
    expect(layout.below(99)).toEqual([]);
  });

  it("finds the same passing lanes as a row-by-row walk, in random histories", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const nodes = history(seed, 300);
      const layout = new Layout({ pinned: nodes.find((node) => node.branch === "main")?.hash });
      const expected: number[][] = [];
      for (const node of nodes) {
        expected.push(openColumns(layout, node.hash));
        layout.add(node);
      }
      nodes.forEach((_, row) => {
        expect(columns(layout.passing(row)), `seed ${seed}, row ${row}`).toEqual(expected[row]);
      });
      expect(layout.columns).toBe(Math.max(...layout.rows.map((row) => row.width)));
    }
  });
});

/** The columns of lanes open before a commit is added, other than those waiting for it. */
function openColumns(layout: Layout, hash: string): number[] {
  type Open = { expects: string; hidden: boolean } | null;
  const lanes = (layout as unknown as { lanes: Open[] }).lanes;
  return lanes.flatMap((lane, i) => (lane && !lane.hidden && lane.expects !== hash ? [i] : []));
}

/**
 * A history of `count` commits on a few branches that fork and merge, newest first, children
 * before parents: made oldest first, each commit on a branch picked at random.
 */
function history(seed: number, count: number): GraphNode[] {
  let state = seed;
  const random = () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state / 2 ** 32;
  };
  const tips = new Map<string, string>();
  const made: GraphNode[] = [];
  for (let i = 0; i < count; i++) {
    const hash = `c${i}`;
    const names = [...tips.keys()];
    const parents: string[] = [];
    let name = "main";
    if (names.length > 0) {
      name = random() < 0.15 ? `b${i}` : (names[Math.floor(random() * names.length)] as string);
      const from = tips.get(name) ?? tips.get(names[Math.floor(random() * names.length)] as string);
      if (from) parents.push(from);
      const other = names[Math.floor(random() * names.length)] as string;
      if (random() < 0.2 && other !== name && tips.get(other) !== from) {
        parents.push(tips.get(other) as string);
        if (random() < 0.5 && other !== "main") tips.delete(other); // merged and deleted
      }
    }
    tips.set(name, hash);
    made.push({ hash, parents, ...(name === "main" ? { branch: "main" } : {}) });
  }
  return made.reverse();
}
