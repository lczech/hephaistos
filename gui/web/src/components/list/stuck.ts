// Which rows of a list stick below its header, and where: worked out from the rows as measured,
// as only those near the view are drawn (`VirtualRows`).

/** Of a list's rows, flat: the index of each one's parent, its depth, and what it holds. */
export interface Shape {
  parent: Int32Array; // -1 at the top level
  depth: Int32Array;
  last: Int32Array; // the last row within it, or itself
  holds: Uint8Array; // 1 where its content is open: the rows within it, or its details
}

/** A row as its shape needs it: how deep, and whether its content is open. */
export interface Holding {
  depth: number;
  holds: boolean;
}

/** The shape of rows given in order, each after the one holding it. */
export function shapeOf(rows: readonly Holding[]): Shape {
  const n = rows.length;
  const shape: Shape = {
    parent: new Int32Array(n).fill(-1),
    depth: new Int32Array(n),
    last: new Int32Array(n),
    holds: new Uint8Array(n),
  };
  const open: number[] = []; // the rows holding the one at hand, outermost first
  rows.forEach((row, at) => {
    while (open.length > 0 && (shape.depth[open.at(-1) ?? 0] ?? 0) >= row.depth) open.pop();
    shape.parent[at] = open.at(-1) ?? -1;
    shape.depth[at] = row.depth;
    shape.holds[at] = row.holds ? 1 : 0;
    shape.last[at] = at;
    for (const holder of open) shape.last[holder] = at;
    open.push(at);
  });
  return shape;
}

/** Where a row lies, as measured: from its start to its end, its content too. */
export interface Measure {
  start: number;
  end: number;
}

/** A row stuck: its index, `top` from the line below the header, and its own height. */
export interface Stuck {
  index: number;
  top: number;
  height: number;
}

/**
 * The rows stuck below the line `line` (the header's end, where the rows scroll by): at each
 * level, the one holding the row below those above it, once scrolled past that line, as long as
 * what it holds scrolls past.
 * Each is pushed up by the end of what it holds, sliding out below the one holding it; so is
 * every one below it. `own` is the height of a row itself, without its details; `offset` where it
 * starts in its room, below what stands above it there, e.g. the line starting a group. Tops are
 * whole pixels from the line, so that text lands on them.
 */
export function stuckRows(
  measures: readonly Measure[],
  shape: Shape,
  line: number,
  own: (index: number) => number,
  offset: (index: number) => number = () => 0,
): Stuck[] {
  const out: Stuck[] = [];
  let y = line;
  for (let level = 0; ; level++) {
    const below = rowAt(measures, y);
    if (below === undefined) break;
    let at = below;
    while (at >= 0 && (shape.depth[at] ?? 0) > level) at = shape.parent[at] ?? -1;
    if (at < 0 || shape.depth[at] !== level || !shape.holds[at]) break;
    if (level > 0 && shape.parent[at] !== out[level - 1]?.index) break;
    const [room, end] = [measures[at]?.start, measures[shape.last[at] ?? at]?.end];
    if (room === undefined || end === undefined) break;
    if (room + offset(at) >= y - 0.5) break; // in its place, not scrolled past: itself, not a copy
    const height = own(at);
    // The end of what it holds reaching it: it is pushed up, out of view below those above it.
    const top = Math.min(y, end - height);
    out.push({ index: at, top: Math.round(top - line), height });
    if (top < y) break; // leaving: none below it
    y += height;
  }
  return out;
}

/** The index of the row at `y`, as measured: a binary search. */
export function rowAt(measures: readonly Measure[], y: number): number | undefined {
  let [low, high] = [0, measures.length - 1];
  if (high < 0 || (measures[high]?.end ?? 0) <= y || (measures[0]?.start ?? 0) > y)
    return undefined;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((measures[middle]?.end ?? 0) <= y) low = middle + 1;
    else high = middle;
  }
  return low;
}
