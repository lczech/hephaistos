import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Schemas } from "../../api/client";
import { linesOf, listRows } from "../../test/list";
import { clone, info, json, renderWithQueries, repository, serve } from "../../test/server";
import { expectSettled, InPanel } from "../../test/view";
import type { Change } from "../comparison/rows";
import { ChangesView } from "./ChangesView";

// How the Changes View lays out its rows, as a browser draws it: the styles of lists of changes
// select the List's rows, which only a browser applies.

function change(path: string, fields: Partial<Change> = {}): Change {
  return {
    path,
    status: "M",
    original: null,
    added: 1,
    removed: 0,
    binary: false,
    size: null,
    old_size: null,
    files: null,
    more_files: false,
    ...fields,
  };
}

/** A Clone with files changed, one of them binary, in two lines, in a Panel this wide. */
async function changes(width: number) {
  localStorage.setItem("hephaistos.lists.changes.layout", '"lines"');
  const answer: Schemas["ChangesJson"] = {
    branch: { head: "abc", branch: "main", upstream: null, ahead: 0, behind: 0 },
    commit: null,
    groups: [
      {
        name: "unstaged",
        from: "index",
        to: "working-tree",
        changes: [
          change("README.md", { added: 3, removed: 1 }),
          change("a-longer-name.txt", { added: 150, removed: 50 }),
          change("logo.png", { added: null, removed: null, binary: true, size: 2000 }),
        ],
        count: 3,
      },
    ],
  };
  serve({
    "GET /api/info": () => json(info()),
    "GET /api/repositories": () => json([repository("proj", [clone("proj")])]),
    "GET /api/changes": () => json(answer),
  });
  renderWithQueries(
    <div style={{ width }}>
      <InPanel view={ChangesView} kind="changes" params={{ clone: "clone-proj" }} />
    </div>,
  );
  await screen.findByText("logo.png");
  await expectSettled();
}

/** Each row's text, and its cells line by line, as drawn. */
const drawn = () =>
  listRows().map((row) => [row.querySelector('[data-column="path"]')?.textContent, linesOf(row)]);

/** Where each row's count of lines ends. */
const ends = () =>
  listRows().map(
    (row) => row.querySelector('[data-column="lines"]')?.getBoundingClientRect().right ?? 0,
  );

describe("the Changes View, drawn", () => {
  it("in two lines, keeps each row in one, the counts of lines lined up, bars after them", async () => {
    await changes(700);
    expect(drawn()).toEqual([
      ["Total: 3 files", [["path", "lines"]]],
      [expect.stringContaining("Not staged"), [["path", "lines"]]],
      ["README.md", [["path", "lines", "meter"]]],
      ["a-longer-name.txt", [["path", "lines", "meter"]]],
      ["logo.png", [["path", "lines"]]], // binary: no bars, their room kept
    ]);
    expect(Math.max(...ends()) - Math.min(...ends())).toBeLessThan(1);
  });

  it("in two lines, very narrow, leaves the bars out", async () => {
    await changes(400);
    expect(drawn().map(([, lines]) => lines)).toEqual(Array(5).fill([["path", "lines"]]));
    expect(Math.max(...ends()) - Math.min(...ends())).toBeLessThan(1);
  });
});
