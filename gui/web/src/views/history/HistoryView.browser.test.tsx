import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { linesOf, listRows } from "../../test/list";
import { clone, info, json, renderWithQueries, repository, serve } from "../../test/server";
import { expectSettled, InPanel } from "../../test/view";
import type { Commit } from "../commits/rows";
import { HistoryView } from "./HistoryView";

// How the History View lays out its rows, as a browser draws it: its styles select the List's
// rows, which only a browser applies.

function commit(n: number, renamed_from: string | null = null): Commit {
  const person = { name: "Lucas", email: "lucas@example.org", at: new Date().toISOString() };
  const hash = `${n}`.padStart(40, "c");
  return {
    hash,
    parents: [],
    subject: `Commit ${n}`,
    body: "",
    author: person,
    committer: person,
    refs: [],
    renamed_from,
  };
}

/** A file's History: two commits, the older one renaming it. */
async function history() {
  const commits = [commit(2), commit(1, "old/rows.ts")];
  serve({
    "GET /api/info": () => json(info()),
    "GET /api/repositories": () => json([repository("proj", [clone("proj")])]),
    "GET /api/history": () =>
      json({ head: commits[0]?.hash, branch: "main", refs: [], commits, next: null, found: null }),
  });
  renderWithQueries(
    <div style={{ width: 700 }}>
      <InPanel
        view={HistoryView}
        kind="history"
        params={{ clone: "clone-proj", path: "rows.ts" }}
      />
    </div>,
  );
  await screen.findByText("Commit 1");
  await expectSettled();
}

describe("the History View, drawn", () => {
  it("in two lines, puts the hash and subject first, who and when below them", async () => {
    localStorage.setItem("hephaistos.lists.history.layout", '"lines"');
    await history();
    expect(linesOf(listRows()[0] as HTMLElement)).toEqual([
      ["square", "commit", "subject"],
      ["author", "authored"],
    ]);
  });

  it("parts the commits before a file's renaming from those after by a line", async () => {
    await history();
    const tops = listRows().map((row) => getComputedStyle(row).borderTopWidth);
    expect(tops).toEqual(["0px", "0px", "1px"]); // the last row: where it was renamed
  });
});
