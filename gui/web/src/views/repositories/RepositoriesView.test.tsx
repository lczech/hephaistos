import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { cells } from "../../test/list";
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
import { addressText, type Params } from "../address";
import { type OpenView, OpenViewContext } from "../opening";
import { RepositoriesView } from "./RepositoriesView";

/** Three Repositories: one active minutes ago in a Worktree, one a day ago, one never. */
function serveRepositories() {
  const recent = clone("recent", {
    active_at: secondsAgo(3600),
    changed: 2,
    worktrees: [worktree("recent", "feature", { active_at: secondsAgo(300) })],
  });
  const old = clone("old", { active_at: secondsAgo(86_400), conflicted: 1 });
  return serve({
    "GET /api/info": () => json(info()),
    "GET /api/repositories": () =>
      json([
        repository("idle", [clone("idle", { present: false })]),
        repository("old", [old]),
        repository("recent", [recent], { remotes: ["/home/me/mirror", "github.com/me/recent"] }),
      ]),
  });
}

/** The View as a Panel holds it: with its parameters, shown as its address. */
function Repositories({ open = () => {} }: { open?: OpenView }) {
  const [params, setParams] = useState<Params>({});
  return (
    <OpenViewContext value={open}>
      <output>{addressText({ kind: "repositories", params })}</output>
      <RepositoriesView params={params} setParams={setParams} setTitle={() => {}} />
    </OpenViewContext>
  );
}

const names = () => screen.getAllByRole("listitem").map((row) => cells(row)[1]); // after the link

describe("the Repositories View", () => {
  it("lists the most recently active first, each with its Clones and their Worktrees", async () => {
    serveRepositories();
    renderWithQueries(<Repositories />);
    await screen.findByText("recent");
    expect(names()).toEqual([
      "recent",
      "~/recent",
      ".worktrees/feature",
      "old",
      "~/old",
      "idle",
      "~/idle",
    ]);
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((row) => row.dataset.depth)).toEqual([
      undefined,
      "1",
      "2",
      undefined,
      "1",
      undefined,
      "1",
    ]);
    expect(rows.map((row) => row.dataset.tone)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      "danger",
      undefined,
      "warning",
    ]);
    expect(cells(rows[1] as HTMLElement).slice(3, 5)).toEqual(["main", "~2"]);
    expect(screen.getByTitle("2 changed; up to date with origin/main")).toBeInTheDocument();
    const resizable = [...document.querySelectorAll("[data-column]:has(> hr)")];
    expect(resizable.map((header) => header.getAttribute("data-column"))).toEqual([
      "name",
      "branch",
      "status",
      "active",
    ]);
  });

  it("sorts by name when asked, keeping the order in its parameters", async () => {
    serveRepositories();
    renderWithQueries(<Repositories />);
    await screen.findByText("recent");
    await userEvent.click(screen.getByRole("button", { name: "name" }));
    expect(screen.getByRole("status")).toHaveTextContent("repositories?sort=name");
    expect(names().filter((name) => !name?.includes("/"))).toEqual(["idle", "old", "recent"]);
  });

  it("opens the Events of a Repository, Clone or Worktree", async () => {
    serveRepositories();
    const open = vi.fn<OpenView>();
    renderWithQueries(<Repositories open={open} />);
    await screen.findByText("recent");
    await userEvent.click(screen.getByRole("button", { name: "Events of recent" }));
    await userEvent.click(screen.getByRole("button", { name: "Events of ~/recent" }));
    await userEvent.click(screen.getByRole("button", { name: "Events of .worktrees/feature" }));
    expect(open.mock.calls.map(([address]) => addressText(address))).toEqual([
      "events?repository=repo-recent",
      "events?clone=clone-recent",
      "events?worktree=wt-recent-feature",
    ]);
  });

  it("opens the History of a Clone or Worktree, as a preview, in its Group or beside it", async () => {
    serveRepositories();
    const open = vi.fn<OpenView>();
    renderWithQueries(<Repositories open={open} />);
    await screen.findByText("recent");
    expect(screen.queryByRole("button", { name: "Commit history of recent" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Commit history of ~/recent" }));
    await userEvent.pointer({
      keys: "[MouseMiddle]",
      target: screen.getByRole("button", { name: "Commit history of .worktrees/feature" }),
    });
    expect(open.mock.calls.map(([address, opening]) => [addressText(address), opening])).toEqual([
      ["history?clone=clone-recent", { beside: false, preview: true }],
      ["history?worktree=wt-recent-feature", { beside: true, preview: true }],
    ]);
  });

  it("opens the Changes of a Clone or Worktree, as a preview", async () => {
    serveRepositories();
    const open = vi.fn<OpenView>();
    renderWithQueries(<Repositories open={open} />);
    await screen.findByText("recent");
    expect(screen.queryByRole("button", { name: "Changes in recent" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Changes in ~/recent" }));
    await userEvent.click(screen.getByRole("button", { name: "Changes in .worktrees/feature" }));
    expect(open.mock.calls.map(([address, opening]) => [addressText(address), opening])).toEqual([
      ["changes?clone=clone-recent", { beside: false, preview: true }],
      ["changes?worktree=wt-recent-feature", { beside: false, preview: true }],
    ]);
    // Greyed out without changes: the Worktree has none, the Clone 2 changed.
    const feature = screen.getByRole("button", { name: "Changes in .worktrees/feature" });
    expect(feature).toHaveAttribute("title", "Changes in .worktrees/feature: no changes");
    expect(feature.className).toMatch(/quiet/);
    expect(screen.getByRole("button", { name: "Changes in ~/recent" }).className).not.toMatch(
      /quiet/,
    );
  });

  it("links a Repository to its page on its forge, in a new tab", async () => {
    serveRepositories();
    renderWithQueries(<Repositories />);
    await screen.findByText("recent");
    const [link] = screen.getAllByRole("link", { name: "https://github.com/me/recent on GitHub" });
    expect(link).toHaveAttribute("href", "https://github.com/me/recent");
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.getAllByRole("link")).toHaveLength(1); // the others' remotes are on no forge
    const [row] = screen.getAllByRole("listitem");
    await userEvent.click(within(row as HTMLElement).getAllByRole("button")[0] as HTMLElement);
    const details = within(screen.getByRole("region", { name: "Details" }));
    expect(details.getByText("/home/me/mirror", { exact: false })).toBeInTheDocument();
    expect(details.getByRole("link", { name: "https://github.com/me/recent" })).toBeInTheDocument();
  });

  it("shows a Clone's details without what's empty", async () => {
    serveRepositories();
    renderWithQueries(<Repositories />);
    await screen.findByText("recent");
    const [, row] = screen.getAllByRole("listitem");
    await userEvent.click(within(row as HTMLElement).getAllByRole("button")[0] as HTMLElement);
    const details = within(screen.getByRole("region", { name: "Details" }));
    expect(details.getByText("remote origin")).toBeInTheDocument();
    expect(details.getByText("laptop-local")).toBeInTheDocument();
    expect(details.queryByText("error")).toBeNull();
    expect(details.queryByText("resolved path")).toBeNull();
  });
});
