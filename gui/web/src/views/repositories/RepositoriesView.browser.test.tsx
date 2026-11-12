import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { linesOf, listRows } from "../../test/list";
import {
  clone,
  info,
  json,
  renderWithQueries,
  repository,
  secondsAgo,
  serve,
  worktree,
} from "../../test/server";
import { expectSettled, InPanel } from "../../test/view";
import { RepositoriesView } from "./RepositoriesView";

// How the Repositories View lays out its rows, as a browser draws it: its styles select the List's
// rows, which only a browser applies.

/** One Repository, its Clone and the Clone's Worktree, all active a while ago. */
async function repositories() {
  const active = { active_at: secondsAgo(600) };
  const tree = worktree("r", "feature", active);
  serve({
    "GET /api/info": () => json(info()),
    "GET /api/repositories": () =>
      json([repository("r", [clone("r", { ...active, worktrees: [tree] })])]),
  });
  renderWithQueries(
    <div style={{ width: 700 }}>
      <InPanel view={RepositoriesView} kind="repositories" />
    </div>,
  );
  await screen.findByText(".worktrees/feature");
  await expectSettled();
}

describe("the Repositories View, drawn", () => {
  it("starts a Clone's name within its Repository's, and a Worktree's within its Clone's", async () => {
    await repositories();
    // Where each row's name starts: its text, past the padding of its cell.
    const [ofRepository, ofClone, ofWorktree] = listRows().map((row) => {
      const range = document.createRange();
      range.selectNodeContents(row.querySelector('[data-column="name"]') ?? row);
      return range.getBoundingClientRect().left;
    });
    expect(ofClone).toBeGreaterThan((ofRepository ?? 0) + 4);
    expect(ofWorktree).toBeGreaterThan((ofClone ?? 0) + 4);
    const weights = listRows().map((row) => {
      const name = row.querySelector('[data-column="name"]');
      return name ? Number(getComputedStyle(name).fontWeight) : 0;
    });
    expect(weights[0]).toBeGreaterThan(weights[1] ?? 0);
  });

  it("in two lines, puts a Repository on one, and a Checkout's branch and when below it", async () => {
    localStorage.setItem("hephaistos.lists.repositories.layout", '"lines"');
    await repositories();
    expect(listRows().map((row) => linesOf(row))).toEqual([
      [["square", "name", "active", "views"]],
      [
        ["square", "name", "status", "views"],
        ["branch", "active"],
      ],
      [
        ["square", "name", "status", "views"],
        ["branch", "active"],
      ],
    ]);
  });
});
