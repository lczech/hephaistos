import { useLayoutEffect, useRef, useState } from "react";
import { cssVars } from "../../components/cssVars";
import { hueColour } from "../../hues";
import { useDevicePixelRatio } from "../../useDevicePixelRatio";
import styles from "./Graph.module.css";
import type { Bend, LaneColour, Layout, Line, NodeKind } from "./lanes";

const LANE = 12; // px per lane
const MOST_FITTED = 8; // lanes the column fits until resized; more are cut off at its edge
const SIZE = 14; // px of the box a node is drawn in
// How far solid lines start above the top of their row, under the end of those of the row above,
// so that no seam shows where rows meet at a fraction of a pixel: in px below the first line of a
// row, in the units of half the height of its first line (some 11px) in it.
const OVER = 2;
const OVER_HEAD = 0.2;

/** The width of the graph column fitted to its lanes, until resized. */
export function fittedWidth(lanes: number): number {
  return Math.min(Math.max(lanes, 1), MOST_FITTED) * LANE + LANE / 2;
}

/** The colour of a lane as CSS. */
export function colourOf(colour: LaneColour): string {
  return colour.kind === "accent" ? "var(--accent)" : hueColour(colour.hue, colour.muted);
}

const x = (lane: number) => LANE / 2 + lane * LANE;

/** The stroke of a line in an SVG: dashed only for a curve; a straight lane dashed is `Dashes`. */
function stroke(colour: LaneColour, dashed: boolean) {
  return {
    stroke: colourOf(colour),
    strokeDasharray: dashed ? "2 3" : undefined,
  };
}

/**
 * The part of the graph in a row, across the whole row however high it is: in the height of its
 * first line (`--graph-node-y` twice), the lanes passing, that of the node coming from above,
 * others ending in it, and those of its parents leaving it; below, down to the end of the row,
 * those going on. A stretch has no node: its lane passes its row dashed.
 */
export function GraphCell({ layout, row }: { layout: Layout; row: number }) {
  const graph = layout.rows[row];
  if (graph === undefined) return null;
  const width = layout.columns * LANE;
  const passing = layout.passing(row);
  const stretch = graph.node === "stretch";
  const above = graph.above && (stretch ? { ...graph.above, dashed: true } : graph.above);
  const out = stretch ? graph.out.map((bend) => ({ ...bend, dashed: true })) : graph.out;
  const below = layout.below(row); // that of a stretch dashed
  // Straight lanes dashed, each in one piece down the row, from its top, the node or the end of
  // the first line (below a curve), to the node or the end of the row.
  const dashes = new Map<number, Piece>();
  const add = (line: Line, from: Piece["from"], to: Piece["to"]) => {
    const piece = dashes.get(line.lane);
    dashes.set(
      line.lane,
      piece
        ? {
            line,
            from: Math.min(piece.from, from) as Piece["from"],
            to: piece.to === null || to === null ? null : 1,
          }
        : { line, from, to },
    );
  };
  for (const line of passing) if (line.dashed) add(line, 0, null);
  if (above?.dashed) add(above, 0, 1);
  for (const bend of out) if (bend.dashed && bend.from === bend.to) add(lineOf(bend), 1, null);
  for (const line of below) if (line.dashed) add(line, 2, null);
  return (
    <span className={styles.rail} data-graph="row">
      <svg
        aria-hidden="true"
        className={styles.head}
        width={width}
        viewBox={`0 0 ${width} 2`}
        preserveAspectRatio="none"
      >
        {passing
          .filter((line) => !line.dashed)
          .map((line) => (
            <Straight key={`p${line.lane}`} line={line} from={-OVER_HEAD} to={2} />
          ))}
        {above && !above.dashed && <Straight line={above} from={-OVER_HEAD} to={1} />}
        {graph.into.map((bend) => (
          <Curve key={`i${bend.from}`} bend={bend} into />
        ))}
        {out
          .filter((bend) => !(bend.dashed && bend.from === bend.to))
          .map((bend) =>
            // Straight down in the lane of the node: a line, sharp as those passing it.
            bend.from === bend.to ? (
              <Straight key={`o${bend.to}`} line={lineOf(bend)} from={1} to={2} />
            ) : (
              <Curve key={`o${bend.to}`} bend={bend} into={false} />
            ),
          )}
      </svg>
      <Below lines={below.filter((line) => !line.dashed)} width={width} className={styles.tail} />
      {[...dashes.values()].map(({ line, from, to }) => (
        <Dashes
          key={`d${line.lane}`}
          line={line}
          top={from === 0 ? "0px" : `calc(${from} * var(--graph-node-y))`}
          bottom={to === null ? "0px" : "calc(100% - var(--graph-node-y))"}
        />
      ))}
      {!stretch && (
        <svg
          aria-hidden="true"
          className={styles.node}
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          style={cssVars({ "--node-x": `${x(graph.lane) - SIZE / 2}px` })}
          data-node={graph.node}
        >
          <Node kind={graph.node} colour={colourOf(graph.colour)} />
        </svg>
      )}
    </span>
  );
}

/**
 * The tips of the lines going on below the row at the top, as the band of a graph shows them, in
 * the first line of a row: a node where a tip with badges is, its line going down from it; the
 * other lines passing. While the row below comes in, `at` down the band, the lines end there, and
 * the part of that row itself is drawn from there, as it is below: its node, the lines ending in
 * it, those leaving it; a tip whose line ends in it is pushed out, higher by `by`.
 */
export function GraphTips({
  layout,
  lines,
  tips,
  next,
}: {
  layout: Layout;
  lines: Line[];
  tips: {
    lane: number;
    node: NodeKind;
    colour: LaneColour;
    by: number;
    coming?: boolean;
    leaving?: boolean;
  }[];
  next?: { row: number; at: number };
}) {
  const width = layout.columns * LANE;
  const tipOf = new Map(tips.map((tip) => [tip.lane, tip]));
  return (
    <span className={styles.rail} data-graph="tips">
      {next && (
        <span className={styles.next} style={cssVars({ "--at": `${next.at}px` })}>
          <GraphCell layout={layout} row={next.row} />
        </span>
      )}
      {lines.map((line) => {
        const tip = tipOf.get(line.lane);
        return (
          <span
            key={line.lane}
            className={styles.segment}
            style={cssVars({
              "--from": tip ? `calc(var(--graph-node-y) + ${tip.by}px)` : "0px",
              "--to": next ? `calc(100% - ${next.at}px)` : "0px",
            })}
          >
            <Below lines={[line]} width={width} className={styles.fill} fromEnd />
          </span>
        );
      })}
      {next &&
        // Above a tip that stays, nothing: the row coming in is drawn up to its top, the line of
        // its tip too, which here goes down from the tip.
        tips
          .filter((tip) => !tip.coming && !tip.leaving)
          .map((tip) => (
            <span
              key={`c${tip.lane}`}
              className={styles.cap}
              style={cssVars({ "--lane-x": `${x(tip.lane)}px` })}
            />
          ))}
      {tips
        .filter((tip) => !tip.coming) // drawn with the part of its row
        .map((tip) => (
          <svg
            key={tip.lane}
            aria-hidden="true"
            className={styles.node}
            width={SIZE}
            height={SIZE}
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            style={cssVars({ "--node-x": `${x(tip.lane) - SIZE / 2}px`, "--by": `${tip.by}px` })}
            data-node={tip.node}
          >
            <Node kind={tip.node} colour={colourOf(tip.colour)} />
          </svg>
        ))}
    </span>
  );
}

/** The lanes going on below a row, beside what opens under it, e.g. the details of a commit. */
export function GraphBeside({ layout, row }: { layout: Layout; row: number }) {
  return (
    <span className={styles.beside} data-graph="beside">
      <Below lines={layout.below(row)} width={layout.columns * LANE} className={styles.fill} />
    </span>
  );
}

interface BelowProps {
  lines: Line[];
  width: number;
  className: string | undefined;
  fromEnd?: boolean; // dashes as from the end, cut off at the start: see `Dashes`
}

function Below({ lines, width, className, fromEnd = false }: BelowProps) {
  return (
    <span className={className}>
      <svg aria-hidden="true" width={width} height="100%">
        {lines
          .filter((line) => !line.dashed)
          .map((line) => (
            <line
              key={line.lane}
              x1={x(line.lane)}
              x2={x(line.lane)}
              y1={-OVER}
              y2="100%"
              {...stroke(line.colour, false)}
            />
          ))}
      </svg>
      {lines
        .filter((line) => line.dashed)
        .map((line) => (
          <Dashes key={line.lane} line={line} top="0px" bottom="0px" fromEnd={fromEnd} />
        ))}
    </span>
  );
}

/** A straight lane dashed in a row: from the top (0), the node (1) or the end of the first line
 * (2), to the node (1) or the end of the row (`null`). */
interface Piece {
  line: Line;
  from: 0 | 1 | 2;
  to: 1 | null;
}

const lineOf = ({ to, colour, dashed, start }: Bend): Line => ({ lane: to, colour, dashed, start });

const DASH = 2; // px of a dash in a lane dashed, about, as whole device pixels
const GAP = 3; // px between dashes, about, as whole device pixels

/**
 * The dashes of a lane dashed, as a dash array in device pixels: of `dash` each, as many as fit
 * `length`, each with about half a gap above and below, so that pieces meet with a gap as any
 * other; or, where the length is not known, periodic, from the start. All their edges are whole
 * device pixels from the start of the line, wherever it starts: drawn with crisp edges, each
 * edge is then rounded alike, and each dash is as long as the others.
 */
function dashArray(length: number | null, dash: number, gap: number): number[] {
  const half = Math.floor(gap / 2);
  if (length === null || length < dash + gap) return [0, half, dash, gap - half];
  const count = Math.round(length / (dash + gap));
  const period = length / count;
  // Each dash in the middle of its share of the length, rounded: the gaps differ by a pixel.
  const starts = Array.from({ length: count }, (_, i) => Math.round((i + 0.5) * period - dash / 2));
  const array = [0, starts[0] ?? 0];
  starts.forEach((start, i) => {
    // The gap to the next dash; after the last, to beyond the end, so that none repeats.
    array.push(dash, (starts[i + 1] ?? start + length) - start - dash);
  });
  return array;
}

/**
 * A straight lane dashed, from `top` to `bottom` of what it is in, in one piece, so that its
 * dashes are even however high that is and wherever it starts (`dashArray`), at any ratio of
 * device pixels, followed as it changes, e.g. with the zoom of the window. `fromEnd`, while the
 * height changes, e.g. in the band as a row comes in, they stay put from the end instead, cut off
 * at the start.
 */
function Dashes({
  line,
  top,
  bottom,
  fromEnd = false,
}: {
  line: Line;
  top: string;
  bottom: string;
  fromEnd?: boolean;
}) {
  const box = useRef<HTMLSpanElement>(null);
  const [height, setHeight] = useState(0);
  const ratio = useDevicePixelRatio();
  useLayoutEffect(() => {
    const element = box.current;
    if (element === null || fromEnd) return;
    setHeight(element.getBoundingClientRect().height);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setHeight(entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [fromEnd]);
  const array = dashArray(
    fromEnd || height <= 0 ? null : Math.round(height * ratio),
    Math.max(1, Math.round(DASH * ratio)),
    Math.max(1, Math.round(GAP * ratio)),
  );
  return (
    <span ref={box} className={styles.dashes} style={cssVars({ "--top": top, "--bottom": bottom })}>
      <svg aria-hidden="true" width={x(line.lane) + LANE / 2} height="100%" data-dashes={line.lane}>
        <line
          x1={x(line.lane)}
          x2={x(line.lane)}
          // From the end, where it is put, if so.
          y1={fromEnd ? "100%" : 0}
          y2={fromEnd ? 0 : "100%"}
          stroke={colourOf(line.colour)}
          strokeDasharray={array.map((each) => each / ratio).join(" ")}
        />
      </svg>
    </span>
  );
}

function Straight({ line, from, to }: { line: Line; from: number; to: number }) {
  return (
    <line
      x1={x(line.lane)}
      x2={x(line.lane)}
      y1={from}
      y2={to}
      vectorEffect="non-scaling-stroke"
      {...stroke(line.colour, line.dashed)}
    />
  );
}

/** A bend in the top half, from another lane into the node; or in the bottom half, from the node
 * to the lane of a parent; straight down in the lane of the node, it is a `Straight`. */
function Curve({ bend, into }: { bend: Bend; into: boolean }) {
  const from = x(bend.from);
  const to = x(bend.to);
  const d = into
    ? `M${from} ${bend.dashed ? 0 : -OVER_HEAD} V0 Q${from} 1 ${to} 1`
    : `M${from} 1 Q${to} 1 ${to} 2`;
  return (
    <path
      d={d}
      fill="none"
      vectorEffect="non-scaling-stroke"
      {...stroke(bend.colour, bend.dashed)}
    />
  );
}

/** A node, as most graphs draw them: a commit a dot; a merge a ring around a dot; HEAD a larger,
 * thicker ring; uncommitted changes a dotted ring. Rings are filled with the background, so that
 * lines end at their edge. */
function Node({ kind, colour }: { kind: NodeKind; colour: string }) {
  const c = SIZE / 2;
  if (kind === "commit") return <circle cx={c} cy={c} r={3.5} fill={colour} />;
  if (kind === "merge") {
    return (
      <>
        <circle cx={c} cy={c} r={4} className={styles.ring} stroke={colour} strokeWidth={1.5} />
        <circle cx={c} cy={c} r={1.5} fill={colour} />
      </>
    );
  }
  if (kind === "head") {
    return <circle cx={c} cy={c} r={5} className={styles.ring} stroke={colour} strokeWidth={2.5} />;
  }
  return (
    <circle
      cx={c}
      cy={c}
      r={4.5}
      className={styles.ring}
      stroke={colour}
      strokeWidth={1.5}
      strokeDasharray="2 2"
    />
  );
}
