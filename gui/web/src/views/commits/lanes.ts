// The lanes of a commit graph, laid out row by row, newest first.
//
// A lane is a column in which a line is drawn from a commit down to the parent it waits for.
// Each row depends only on the rows above it, so a page of older commits continues the layout,
// and rows already drawn never change. Lanes waiting for the same parent stay apart until it
// comes, so that a branch joins another where it left it, and keep their column, so that lines
// are straight. A pinned commit and its first parents keep lane 0, reserved from the top.
//
// Where a lane passes a row is kept once per lane, as the rows it spans, not in every row: a
// graph of many lanes over many rows looks up only the rows it draws (`passing`).

import { hueOf } from "../../hues";

/** The commit of a row, or the uncommitted changes of a Worktree, whose parent is its HEAD. */
export interface GraphNode {
  hash: string;
  parents: readonly string[];
  uncommitted?: boolean;
  branch?: string; // the name of a branch at this commit, which colours a lane it starts
}

/** What colours a lane: the accent, a branch by its name, or none, muted by where it leads. */
export type LaneColour = { kind: "accent" } | { kind: "hue"; hue: number; muted: boolean };

export type NodeKind = "commit" | "merge" | "head" | "uncommitted";

/** A lane through a row: its column, its colour, and dashed where it is not that of a commit. */
export interface Line {
  lane: number;
  colour: LaneColour;
  dashed: boolean;
  start: number | null; // the row of the tip its line starts at; null for a line a merge opened
}

/** A line bending in half of a row: from a column to another; dashed and started as `Line`. */
export interface Bend {
  from: number;
  to: number;
  colour: LaneColour;
  dashed: boolean;
  start: number | null; // that of the line it is part of: the one coming in, or going on
}

export interface RowGraph {
  lane: number;
  colour: LaneColour;
  node: NodeKind;
  start: number | null; // the row of the tip of its line: its own if it starts one; as `Line`
  above: Line | null; // its own lane, coming down into the node
  into: Bend[]; // in the top half: other lanes that end in the node
  out: Bend[]; // in the bottom half: from the node to the lane of each parent, the first straight down
  width: number; // the columns its node, bends and passing lanes take
}

export interface LayoutOptions {
  pinned?: string; // the commit whose first-parent line keeps lane 0, if any
  heads?: ReadonlySet<string>; // the commits HEADs are at, drawn larger: of each Checkout
  accent?: "first" | "pinned"; // which lane takes the accent: lane 0 from the top, or the pinned
}

interface Lane {
  expects: string; // the commit it waits for
  colour: LaneColour;
  dashed: boolean;
  hidden: boolean; // reserved for the pinned commit, not drawn until it comes
  from: number; // the row it starts below
  start: number | null; // as `Line`
}

/** The room of a lane: below row `from` down to above row `to`; open lanes have no `to` yet. */
interface Span {
  lane: number;
  colour: LaneColour;
  dashed: boolean;
  start: number | null;
  from: number;
  to: number;
}

const BUCKET = 64; // rows per bucket of the index of spans

/** The muted colour of a lane no branch starts: by the commit it leads to, so it stays. */
function mutedFor(hash: string): LaneColour {
  return { kind: "hue", hue: hueOf(hash), muted: true };
}

/**
 * The graph of commits listed newest first, children before their parents (the topological or
 * date order of git). A child listed after its parent, as the default order of git may list with
 * clocks apart, draws no line to it rather than one that never ends.
 */
export class Layout {
  readonly rows: RowGraph[] = [];
  private lanes: (Lane | null)[] = [];
  private waiting = new Map<string, number[]>(); // the hash of a commit → the lanes awaiting it
  private seen = new Set<string>();
  private spans: Span[] = [];
  private buckets: Span[][] | null = null; // spans by the buckets of rows they pass; built lazily
  private width = 0;
  private readonly options: LayoutOptions;

  constructor(options: LayoutOptions = {}) {
    this.options = options;
    if (options.pinned) {
      const colour: LaneColour =
        options.accent === "pinned" ? { kind: "accent" } : mutedFor(options.pinned);
      this.set(0, {
        expects: options.pinned,
        colour,
        dashed: false,
        hidden: true,
        from: -1,
        start: null, // its line starts where the pinned commit comes
      });
    }
  }

  /** The most columns any row takes. */
  get columns(): number {
    return this.width;
  }

  add(node: GraphNode): RowGraph {
    const row = this.rows.length;
    const lanes = this.lanes;
    const matched = this.waiting.get(node.hash) ?? [];
    this.waiting.delete(node.hash);
    this.seen.add(node.hash);

    let lane: number;
    let colour: LaneColour;
    let start: number | null = row; // a tip, unless a line comes down into it
    let above: Line | null = null;
    const first = matched[0];
    const reserved = lanes[0];
    if (first !== undefined) {
      const own = lanes[first] as Lane;
      lane = first;
      colour = own.colour;
      if (!own.hidden) {
        start = own.start;
        above = { lane, colour, dashed: own.dashed, start };
      }
    } else if (
      node.uncommitted &&
      reserved?.hidden &&
      reserved.expects === node.parents[0] &&
      this.options.pinned !== undefined
    ) {
      lane = 0; // the uncommitted changes on the pinned commit lead its lane
      colour = reserved.colour;
      this.unwait(0);
    } else {
      lane = this.free(new Set());
      colour = this.colourStarting(lane, row, node);
    }
    const into = matched.slice(1).map((from): Bend => {
      const other = lanes[from] as Lane;
      return { from, to: lane, colour: other.colour, dashed: other.dashed, start: other.start };
    });
    for (const i of matched) this.end(i, row);

    // Columns ending in the node are not reused in its row, so no line seems to pass it.
    const ended = new Set(matched);
    const out: Bend[] = [];
    const dashed = node.uncommitted === true;
    const parents = node.parents.filter((parent) => !this.seen.has(parent));
    const [firstParent, ...others] = parents;
    if (firstParent !== undefined && firstParent === node.parents[0]) {
      this.set(lane, { expects: firstParent, colour, dashed, hidden: false, from: row, start });
      out.push({ from: lane, to: lane, colour, dashed, start });
    } else if (firstParent !== undefined) {
      others.unshift(firstParent); // the first parent was listed already: the rest open lanes
    }
    for (const parent of others) {
      let to = this.waiting.get(parent)?.[0];
      if (to !== undefined) {
        const awaiting = lanes[to] as Lane;
        if (awaiting.hidden) {
          awaiting.hidden = false; // e.g. the pinned branch merged into one listed above it
          awaiting.from = row;
        }
      } else {
        to = this.free(ended);
        this.set(to, {
          expects: parent,
          colour: mutedFor(parent),
          dashed: false,
          hidden: false,
          from: row,
          start: null, // opened by a merge, not by a tip
        });
      }
      const target = lanes[to] as Lane;
      out.push({
        from: lane,
        to,
        colour: target.colour,
        dashed: target.dashed,
        start: target.start,
      });
    }

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
    let width = lane + 1;
    for (const bend of into) width = Math.max(width, bend.from + 1);
    for (const bend of out) width = Math.max(width, bend.to + 1);
    lanes.forEach((open, i) => {
      if (open && !open.hidden) width = Math.max(width, i + 1);
    });
    const graph: RowGraph = {
      lane,
      colour,
      node: this.kindOf(node),
      start,
      above,
      into,
      out,
      width,
    };
    this.rows.push(graph);
    this.width = Math.max(this.width, width);
    this.buckets = null;
    return graph;
  }

  /** The lanes passing row `row`, neither ending nor starting in it, left to right. */
  passing(row: number): Line[] {
    const buckets = this.index();
    const found = (buckets[Math.floor(row / BUCKET)] ?? []).filter(
      (span) => span.from < row && row < span.to,
    );
    const open = this.lanes.flatMap((lane, i): Line[] =>
      lane && !lane.hidden && lane.from < row
        ? [{ lane: i, colour: lane.colour, dashed: lane.dashed, start: lane.start }]
        : [],
    );
    const spanned = found.map(({ lane, colour, dashed, start }) => ({
      lane,
      colour,
      dashed,
      start,
    }));
    return [...spanned, ...open].sort((a, b) => a.lane - b.lane);
  }

  /** The lanes going on below row `row`, through what is shown under it: passing or leaving. */
  below(row: number): Line[] {
    const graph = this.rows[row];
    if (graph === undefined) return [];
    const leaving = graph.out.map(({ to, colour, dashed, start }) => ({
      lane: to,
      colour,
      dashed,
      start,
    }));
    const lines = [...this.passing(row), ...leaving];
    const seen = new Set<number>();
    return lines
      .filter(({ lane }) => !seen.has(lane) && seen.add(lane))
      .sort((a, b) => a.lane - b.lane);
  }

  private kindOf(node: GraphNode): NodeKind {
    if (node.uncommitted) return "uncommitted";
    if (this.options.heads?.has(node.hash)) return "head";
    return node.parents.length > 1 ? "merge" : "commit";
  }

  /** The colour of a lane starting at a node no lane awaited: that of a branch, or of lane 0. */
  private colourStarting(lane: number, row: number, node: GraphNode): LaneColour {
    if (this.options.accent === "first" && lane === 0 && row === 0) return { kind: "accent" };
    if (node.branch !== undefined) return { kind: "hue", hue: hueOf(node.branch), muted: false };
    return mutedFor(node.hash);
  }

  private set(index: number, lane: Lane): void {
    this.lanes[index] = lane;
    const awaiting = this.waiting.get(lane.expects);
    if (awaiting === undefined) this.waiting.set(lane.expects, [index]);
    else {
      awaiting.push(index);
      awaiting.sort((a, b) => a - b); // the leftmost lane takes the commit
    }
  }

  private unwait(index: number): void {
    const expects = (this.lanes[index] as Lane).expects;
    const rest = (this.waiting.get(expects) ?? []).filter((i) => i !== index);
    if (rest.length > 0) this.waiting.set(expects, rest);
    else this.waiting.delete(expects);
  }

  /** A lane ends in row `row`: its room is kept as a span, unless it was never drawn. */
  private end(index: number, row: number): void {
    const lane = this.lanes[index] as Lane;
    if (!lane.hidden && row - lane.from > 1) {
      this.spans.push({
        lane: index,
        colour: lane.colour,
        dashed: lane.dashed,
        start: lane.start,
        from: lane.from,
        to: row,
      });
    }
    this.lanes[index] = null;
  }

  private free(ended: Set<number>): number {
    const index = this.lanes.findIndex((lane, i) => lane === null && !ended.has(i));
    return index >= 0 ? index : this.lanes.length;
  }

  private index(): Span[][] {
    if (this.buckets !== null) return this.buckets;
    const buckets: Span[][] = [];
    for (const span of this.spans) {
      const last = Math.floor((span.to - 1) / BUCKET);
      for (let b = Math.floor((span.from + 1) / BUCKET); b <= last; b++) {
        if (buckets[b] === undefined) buckets[b] = [];
        buckets[b]?.push(span);
      }
    }
    this.buckets = buckets;
    return buckets;
  }
}
