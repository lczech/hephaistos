import { cssVars } from "../../components/cssVars";
import { hueColour } from "../../hues";
import styles from "./Graph.module.css";
import type { Bend, LaneColour, Layout, Line, NodeKind } from "./lanes";

export const LANE = 12; // px per lane
const MOST_FITTED = 8; // lanes the column fits until resized; more are cut off at its edge
const SIZE = 14; // px of the box a node is drawn in
// How far solid lines start above their row's top, under the end of those of the row above, so
// that no seam shows where rows meet at a fraction of a pixel: in px below a row's first line, in
// the units of its first line's half height (some 11px) in it.
const OVER = 2;
const OVER_HEAD = 0.2;

/** The width of the graph column fitted to its lanes, until resized. */
export function fittedWidth(lanes: number): number {
  return Math.min(Math.max(lanes, 1), MOST_FITTED) * LANE + LANE / 2;
}

/** A lane's colour as CSS. */
export function colourOf(colour: LaneColour): string {
  return colour.kind === "accent" ? "var(--accent)" : hueColour(colour.hue, colour.muted);
}

const x = (lane: number) => LANE / 2 + lane * LANE;

function stroke(colour: LaneColour, dashed: boolean) {
  return {
    stroke: colourOf(colour),
    strokeDasharray: dashed ? "2 3" : undefined,
  };
}

/**
 * A row's part of the graph, across the whole row however high it is: in its first line's
 * height (`--graph-node-y` twice), the lanes passing, the node's own coming from above, others
 * ending in it, and its parents' leaving it; below, down to the row's end, those going on.
 */
export function GraphCell({ layout, row }: { layout: Layout; row: number }) {
  const graph = layout.rows[row];
  if (graph === undefined) return null;
  const width = layout.columns * LANE;
  const passing = layout.passing(row);
  return (
    <span className={styles.rail} data-graph="row">
      <svg
        aria-hidden="true"
        className={styles.head}
        width={width}
        viewBox={`0 0 ${width} 2`}
        preserveAspectRatio="none"
      >
        {passing.map((line) => (
          <Straight key={`p${line.lane}`} line={line} from={over(line)} to={2} />
        ))}
        {graph.above && <Straight line={graph.above} from={over(graph.above)} to={1} />}
        {graph.into.map((bend) => (
          <Curve key={`i${bend.from}`} bend={bend} into />
        ))}
        {graph.out.map((bend) => (
          <Curve key={`o${bend.to}`} bend={bend} into={false} />
        ))}
      </svg>
      <Below lines={layout.below(row)} width={width} className={styles.tail} />
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
    </span>
  );
}

/**
 * The tips of the lines going on below the row at the top, as a graph's band shows them, in a
 * row's first line: a node where a tip with badges is, its line going down from it; the other
 * lines passing. While the row below comes in, `at` down the band, the lines end there, and that
 * row's own part is drawn from there, as it is below: its node, the lines ending in it, those
 * leaving it; a tip whose line ends in it is pushed out, higher by `by`.
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
            <Below lines={[line]} width={width} className={styles.fill} />
          </span>
        );
      })}
      {next &&
        // Above a tip that stays, nothing: the row coming in is drawn up to its top, its tip's
        // line too, which here goes down from the tip.
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
        .filter((tip) => !tip.coming) // drawn with its row's part
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

/** The lanes going on below a row, beside what opens under it, e.g. a commit's details. */
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
}

function Below({ lines, width, className }: BelowProps) {
  return (
    <span className={className}>
      <svg aria-hidden="true" width={width} height="100%">
        {lines.map((line) => (
          <line
            key={line.lane}
            x1={x(line.lane)}
            x2={x(line.lane)}
            y1={line.dashed ? 0 : -OVER}
            y2="100%"
            {...stroke(line.colour, line.dashed)}
          />
        ))}
      </svg>
    </span>
  );
}

/** Where a straight line in a row's first line starts: a solid one above the row. */
const over = (line: Line) => (line.dashed ? 0 : -OVER_HEAD);

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
 * to a parent's lane, straight down where it is the node's own. */
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
