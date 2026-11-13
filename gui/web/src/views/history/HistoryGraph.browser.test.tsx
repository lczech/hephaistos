import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import type { Schemas } from "../../api/client";
import { clone, info, json, renderWithQueries, repository, serve } from "../../test/server";
import { InPanel } from "../../test/view";
import { HistoryView } from "./HistoryView";

// How the graph of History lines up with its rows, as browsers lay it out: its nodes, its lanes
// from row to row, and beside what opens below a row.

type Commit = Schemas["CommitJson"];
const AT = new Date(Date.now() - 2 * 3600_000).toISOString();
const person = { name: "Lucas", email: "lucas@example.org", at: AT };
const hash = (name: string) => name.padEnd(40, "0");

function commit(name: string, parents: string[], fields: Partial<Commit> = {}): Commit {
  return {
    hash: hash(name),
    parents: parents.map(hash),
    subject: `Commit ${name}`,
    body: "",
    author: person,
    committer: person,
    refs: [],
    renamed_from: null,
    ...fields,
  };
}

/** HEAD merges a branch f; below, the line it left from; above, what is not committed. */
const COMMITS = [
  commit("e", ["d", "f"]),
  commit("f", ["b"], {
    refs: [{ name: "f", full: "refs/heads/f", kind: "branch", commit: hash("f") }],
  }),
  commit("d", ["c"]),
  commit("c", ["b"]),
  commit("b", ["a"]),
  commit("a", []),
];

async function history(layout: "columns" | "lines") {
  serve({
    "GET /api/info": () => json(info()),
    "GET /api/repositories": () =>
      json([repository("proj", [clone("proj", { staged: 0, changed: 1, untracked: 0 })])]),
    "GET /api/history": () =>
      json({
        head: hash("e"),
        branch: "main",
        refs: [],
        commits: COMMITS,
        next: null,
        found: null,
      }),
  });
  renderWithQueries(
    <div style={{ width: 900, height: 600, display: "flex", flexDirection: "column" }}>
      <InPanel view={HistoryView} kind="history" params={{ clone: "clone-proj" }} />
    </div>,
  );
  await screen.findByText("Commit a");
  if (layout === "lines") {
    await userEvent.click(screen.getByTitle("Each row in two lines, as narrow panels need"));
  }
  await expect.poll(() => document.querySelectorAll("svg[data-node]").length).toBe(7);
  // Wait until all rows are drawn and measured, in the layout.
  const drawn = () =>
    items().filter((item) => {
      const rail = item.querySelector('[data-graph="row"]')?.getBoundingClientRect();
      const row = rowOf(item)?.getBoundingClientRect();
      const lines = layout === "lines" ? item.closest('[data-layout="lines"]') !== null : true;
      return lines && rail && row && rail.height > 0 && Math.abs(rail.height - row.height) < 0.5;
    }).length;
  await expect.poll(drawn).toBe(7);
}

const box = (element: Element | null | undefined) => {
  if (!element) throw new Error("missing element");
  return element.getBoundingClientRect();
};
// The rows listed, drawn: not the header's, nor copies of rows stuck, which have no index.
const items = () => [...document.querySelectorAll<HTMLElement>("[role=row][data-index]")];
const rowOf = (item: Element) => item.querySelector(":scope > div");
const middle = (rect: DOMRect) => rect.top + rect.height / 2;

/** The x of each vertical line drawn in an element's SVGs, on the page. */
function linesX(element: Element): number[] {
  return [...element.querySelectorAll("line")]
    .filter((line) => line.getAttribute("x1") === line.getAttribute("x2"))
    .map((line) => {
      const svg = line.ownerSVGElement as SVGSVGElement;
      return Math.round(box(svg).left + Number(line.getAttribute("x1")));
    })
    .sort((a, b) => a - b);
}

describe.each(["columns", "lines"] as const)("the graph of History in %s", (layout) => {
  it("draws each node in the middle of its row's first line", async () => {
    await history(layout);
    for (const item of items()) {
      const node = item.querySelector("svg[data-node]");
      const first = item.querySelector('[data-column="commit"]');
      expect(Math.abs(middle(box(node)) - middle(box(first)))).toBeLessThan(1.5);
    }
  });

  it("draws the kinds of nodes: what is not committed, HEAD, a merge's branch, commits", async () => {
    await history(layout);
    const kinds = [...document.querySelectorAll("svg[data-node]")].map((node) =>
      node.getAttribute("data-node"),
    );
    expect(kinds).toEqual([
      "uncommitted",
      "head",
      "commit",
      "commit",
      "commit",
      "commit",
      "commit",
    ]);
  });

  it("draws the lanes of a row from its top to its bottom, so they join the next", async () => {
    await history(layout);
    const rows = items();
    rows.forEach((item, at) => {
      const rail = box(item.querySelector('[data-graph="row"]'));
      const row = box(rowOf(item));
      expect(Math.abs(rail.top - row.top)).toBeLessThan(0.5);
      expect(Math.abs(rail.bottom - row.bottom)).toBeLessThan(0.5);
      const next = rows[at + 1];
      if (next) expect(Math.abs(box(next).top - row.bottom)).toBeLessThan(0.5);
    });
  });

  it("starts a row's solid lanes above its top, under the row above's, so no seam shows", async () => {
    await history(layout);
    // Rows meet at a fraction of a pixel, where the ends of two lines, each rounded or smoothed,
    // left a gap or a lighter seam; overlapping, they leave none.
    // Below HEAD, whose line from what is not committed is dashed: those of b, c, d and f.
    for (const item of items().slice(2)) {
      const rail = item.querySelector('[data-graph="row"]') as Element;
      const solid = [...rail.querySelectorAll("line, path")].filter(
        (line) => !line.getAttribute("stroke-dasharray") && box(line).top < box(rail).top + 1,
      );
      expect(solid.length).toBeGreaterThan(0);
      for (const line of solid) expect(box(line).top).toBeLessThan(box(rail).top - 1);
      // Not cut off at the row's top on the way: by the rail, nor by what it is placed in; a
      // cell between, not placed, does not cut it.
      const clips = (element: Element) => getComputedStyle(element).overflowY !== "visible";
      for (let up = solid[0]?.parentElement; up && up !== rail; up = up.parentElement) {
        expect(clips(up)).toBe(false);
      }
      expect(clips(rail)).toBe(false);
      for (
        let up = (rail as HTMLElement).offsetParent;
        up && up !== item && item.contains(up);
        up = (up as HTMLElement).offsetParent
      ) {
        expect(clips(up)).toBe(false);
      }
    }
  });

  it("draws the lanes going on beside a commit's details, lined up with the rows", async () => {
    await history(layout);
    await userEvent.click(screen.getByText("Commit c"));
    const details = await screen.findByRole("region", { name: "Commit details" });
    const opened = details.closest("[role=row]") as HTMLElement;
    const beside = details.querySelector('[data-graph="beside"]');
    const below = items()[items().indexOf(opened) + 1];
    // From the row's bottom to the next row's top, where the same lanes go on: once the rows
    // below are placed anew, the opened one measured.
    await expect.poll(() => Math.abs(box(beside).bottom - box(below).top)).toBeLessThan(0.5);
    expect(Math.abs(box(beside).top - box(rowOf(opened)).bottom)).toBeLessThan(0.5);
    // HEAD's line, and f's going on to b, where the row's own lanes leave it.
    const own = opened.querySelector('[data-graph="row"] > span:has(svg)') as Element;
    expect(linesX(beside as Element)).toHaveLength(2);
    expect(linesX(beside as Element)).toEqual(linesX(own));
    // From above its top, under the row's lines, as a row's own do.
    for (const line of (beside as Element).querySelectorAll("line")) {
      expect(box(line).top).toBeLessThan(box(beside).top - 1);
    }
    // The details start after the graph, not over it.
    expect(box(details).left).toBeGreaterThanOrEqual(box(beside).right);
  });
});
