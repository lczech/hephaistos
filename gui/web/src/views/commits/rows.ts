// What a list of commits holds: what is not committed, above HEAD; the commits; where a file was
// renamed, the path it had before; a commit found by its hash elsewhere. And what its graph is
// drawn from: the rows laid out in lanes, and the tips of the lines at the top.

import type { Schemas } from "../../api/client";
import { numberText } from "../../text";
import type { Checkout } from "../checkout";
import { type GraphNode, type Line as Lane, type LaneColour, Layout, type NodeKind } from "./lanes";

export type Commit = Schemas["CommitJson"];
export type Ref = Schemas["RefJson"];
export type Found = Schemas["FoundCommitJson"];

/** What is not committed in a Checkout, above its HEAD: that of History, or one of those of a
 * Graph. */
export interface Uncommitted {
  type: "uncommitted";
  text: string;
  of?: { checkout: Checkout; head: string; key: string }; // of a Graph: its Checkout and HEAD
}

/** A commit as a graph lays it out: listed, or only walked (`/api/graph/lines`). */
export type Line = Pick<Commit, "hash" | "parents" | "refs">;

/** The rows a graph lays out: commits, listed or only walked, and what is not committed; others
 * have no row in it. */
export type Laid = Uncommitted | { type: "commit"; commit: Line } | { type: "found" | "renamed" };

export type Entry =
  | Uncommitted // above the commits, when those of HEAD are shown
  | { type: "found"; found: Found } // a commit searched for by its hash, not among them
  | { type: "commit"; commit: Commit }
  | { type: "renamed"; commit: string; from: string }; // below the commit that renamed it

/** The rows of these commits, newest first: each once, and below one that renamed the file,
 * where it was before. */
export function entries(commits: Commit[]): Entry[] {
  const seen = new Set<string>();
  return commits.flatMap((commit): Entry[] => {
    if (seen.has(commit.hash)) return []; // pages may overlap while new commits come
    seen.add(commit.hash);
    const row: Entry = { type: "commit", commit };
    return commit.renamed_from === null
      ? [row]
      : [row, { type: "renamed", commit: commit.hash, from: commit.renamed_from }];
  });
}

/** The rows of commits searched for, with the commit a hash searched for named first: as one
 * of them if listed, else saying where it is. */
export function searchedEntries(found: Found | null | undefined, commits: Commit[]): Entry[] {
  if (!found) return entries(commits);
  if (found.where === "listed") return entries([found.commit, ...commits]);
  return [{ type: "found", found }, ...entries(commits)];
}

/** Where a commit searched for by its hash is, if not listed: `not on main, but on:`. */
export function whereText(found: Found, walked: string, path: string | undefined): string {
  if (found.where === "path") return `does not change ${path}`;
  if (found.where === "refs") return `not on ${walked}, but on:`;
  return "no branch or tag leads to it any more";
}

export function entryId(entry: Entry): string {
  if (entry.type === "uncommitted") return uncommittedId(entry);
  if (entry.type === "found") return `found:${entry.found.commit.hash}`;
  return entry.type === "commit" ? entry.commit.hash : `renamed:${entry.commit}`;
}

/** The ID of the row of what is not committed: that of History, or of a Graph, by its Checkout. */
function uncommittedId(entry: Uncommitted): string {
  return entry.of ? `uncommitted:${entry.of.key}` : "uncommitted";
}

/** What the State of a Checkout says is not committed, in words; empty for a bare Clone, or
 * none. */
export function uncommittedIn(
  state:
    | {
        conflicted: number | null;
        staged: number | null;
        changed: number | null;
        untracked: number | null;
      }
    | undefined,
): string {
  if (state === undefined || state.staged === null) return ""; // bare: no working tree
  return uncommittedText({
    conflicted: state.conflicted ?? 0,
    staged: state.staged,
    changed: state.changed ?? 0,
    untracked: state.untracked ?? 0,
  });
}

/** How many files of each kind are not committed: `2 staged, 5 changed, 3 untracked`. */
export function uncommittedText(counts: {
  conflicted: number;
  staged: number;
  changed: number;
  untracked: number;
}): string {
  const parts: [number, string][] = [
    [counts.conflicted, "conflicted"],
    [counts.staged, "staged"],
    [counts.changed, "changed"],
    [counts.untracked, "untracked"],
  ];
  return parts
    .filter(([count]) => count > 0)
    .map(([count, what]) => `${numberText(count)} ${what}`)
    .join(", ");
}

/** Whether someone else committed it than wrote it: only then is the committer worth showing. */
export function committedApart(author: Commit["author"], committer: Commit["author"]): boolean {
  return author.name !== committer.name || author.email !== committer.email;
}

/** The graph of the commits listed, the row of each entry in it, by its ID, and the entry and
 * ID of each row. */
export interface Drawn {
  layout: Layout;
  rows: Map<string, number>;
  laid: { entry: Laid; id: string }[];
  drawing: Drawing;
}

/**
 * How a list draws its graph: the commit of HEAD and the others drawn as HEADs, and which line
 * takes lane 0 and the accent: the first, as that of History from where it starts, or that of a
 * pinned commit, as the default branch of the Graph View; none, `pinned` without one.
 */
export interface Drawing {
  heads: ReadonlySet<string>;
  accent?: "first" | "pinned"; // by default `pinned` if a commit is, else `first`
  pinned?: string;
  checkedOut?: CheckedOut[]; // where the Checkouts are, marked on the badges
  first?: string; // the default branch, the first of the badges
  hidden?: ReadonlySet<string>; // local branches hidden: without badges, naming no lane
}

/** A Checkout of a Clone, as a Graph marks where it is: on the badge of its branch, or by a HEAD
 * badge of its own when detached. */
export interface CheckedOut {
  name: string; // the folder of the Clone or Worktree
  path: string; // where it is, telling apart Checkouts in folders of the same name
  worktree: boolean; // a Worktree, else the main working tree of the Clone
  branch: string | null; // null when detached
  commit: string | null; // null before the first commit
}

/**
 * The graph of these entries, newest first: their commits, and above the commit of HEAD what is
 * not committed. Other entries have no row in it.
 */
export function graphOf(
  entries: readonly Laid[],
  head: string | null | undefined,
  drawing: Drawing,
): Drawn {
  const { heads, pinned, accent = pinned === undefined ? "first" : "pinned" } = drawing;
  const layout = new Layout({ heads, pinned, accent });
  const rows = new Map<string, number>();
  const laid: Drawn["laid"] = [];
  const checkedOut = drawing.checkedOut ?? [];
  for (const entry of entries) {
    if (entry.type === "commit") {
      const { hash, parents, refs } = entry.commit;
      rows.set(hash, layout.rows.length);
      laid.push({ entry, id: hash });
      const branch = branchOf(shownRefs(refs, drawing));
      const detached = checkedOut.find((each) => each.branch === null && each.commit === hash);
      layout.add({ hash, parents, branch, checkout: detached?.name });
    } else if (entry.type === "uncommitted" && (entry.of?.head ?? head)) {
      const id = uncommittedId(entry);
      rows.set(id, layout.rows.length);
      laid.push({ entry, id });
      const parent = (entry.of?.head ?? head) as string;
      const own = checkedOut.find((each) => each.path === entry.of?.key);
      layout.add({
        hash: id,
        parents: [parent],
        uncommitted: true,
        ...uncommittedColour(own, drawing),
      });
    }
  }
  return { layout, rows, laid, drawing };
}

/**
 * What colours the line of what is not committed in a Checkout, as it will be once committed: its
 * branch, else the Checkout itself, detached or on a hidden branch.
 */
function uncommittedColour(
  own: CheckedOut | undefined,
  drawing: Drawing,
): Pick<GraphNode, "branch" | "checkout"> {
  if (own === undefined) return {};
  if (own.branch === null || drawing.hidden?.has(own.branch)) return { checkout: own.name };
  return { branch: own.branch };
}

/** The tip of a line, where it starts: its row and ID, its node, the commit its badges are of
 * (that of HEAD, for what is not committed above it), and the lane and colour of its line below a
 * row. */
export interface Tip {
  row: number;
  id: string;
  node: NodeKind;
  commit: Line;
  lane: number;
  colour: LaneColour;
  coming?: boolean; // of the row below, coming in: its line not among those going on yet
  leaving?: boolean; // its line ends in the row below, coming in, which pushes it out
}

/**
 * The lines going on below row `row`, and the tips of those that start in it or above it, by
 * lane: each with badges, the refs of its commit or the HEAD of a Checkout detached there. The
 * others, and those a merge opened, pass as lines alone. With `next`, the row below, coming in,
 * its tip too, if it starts a line with badges; and those whose lines end in it are marked as
 * leaving.
 */
export function tipsAt(
  drawn: Drawn,
  row: number,
  head: string | null | undefined,
  next?: number,
): { lines: Lane[]; tips: Tip[] } {
  const lines = drawn.layout.below(row);
  const commitOf = (at: number): Line | undefined => {
    const laid = drawn.laid[at]?.entry;
    if (laid?.type === "commit") return laid.commit;
    if (laid?.type !== "uncommitted") return undefined;
    const parent = drawn.rows.get(laid.of?.head ?? head ?? "");
    const below = parent === undefined ? undefined : drawn.laid[parent]?.entry;
    return below?.type === "commit" ? below.commit : undefined;
  };
  const labelled = (commit: Line) =>
    shownRefs(commit.refs, drawn.drawing).length > 0 ||
    commit.hash === head ||
    (drawn.drawing.checkedOut ?? []).some(
      (each) => each.branch === null && each.commit === commit.hash,
    );
  const seen = new Set<number>();
  const tips = lines.flatMap(({ lane, colour, start }): Tip[] => {
    if (start === null || start > row || seen.has(start)) return [];
    seen.add(start);
    const commit = commitOf(start);
    const [graph, laid] = [drawn.layout.rows[start], drawn.laid[start]];
    if (commit === undefined || graph === undefined || laid === undefined) return [];
    if (!labelled(commit)) return [];
    return [{ row: start, id: laid.id, node: graph.node, commit, lane, colour }];
  });
  if (next !== undefined) {
    const going = new Set(drawn.layout.below(next).map((line) => line.start));
    for (const tip of tips) if (!going.has(tip.row)) tip.leaving = true;
    const [graph, laid, commit] = [drawn.layout.rows[next], drawn.laid[next], commitOf(next)];
    if (graph && graph.start === next && laid && commit && labelled(commit)) {
      const { lane, colour, node } = graph;
      tips.push({ row: next, id: laid.id, node, commit, lane, colour, coming: true });
      tips.sort((a, b) => a.lane - b.lane);
    }
  }
  return { lines, tips };
}

/** The refs a graph labels a commit with: all but the local branches hidden. */
export function shownRefs(refs: Ref[], drawing: Drawing | undefined): Ref[] {
  const hidden = drawing?.hidden;
  if (hidden === undefined || hidden.size === 0) return refs;
  return refs.filter((ref) => ref.kind !== "branch" || !hidden.has(ref.name));
}

/** The branch the lane of a commit is named by: a local one, else a remote one by its own name. */
export function branchOf(refs: Ref[]): string | undefined {
  const local = refs.find((ref) => ref.kind === "branch");
  if (local) return local.name;
  const remote = refs.find((ref) => ref.kind === "remote");
  return remote?.name.slice(remote.name.indexOf("/") + 1);
}
