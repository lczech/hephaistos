import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Schemas } from "../../api/client";
import { exactRequests } from "../../test/fuzz";
import { cells, endOfList, listRows } from "../../test/list";
import { clone, info, json, renderWithQueries, repository, serve } from "../../test/server";
import { expectSettled, InPanel } from "../../test/view";
import { type Address, addressText, type Params } from "../address";
import type { Commit } from "../commits/rows";
import { type Opening, OpenViewContext, ShownContext } from "../opening";
import { HistoryView } from "./HistoryView";

const AT = new Date(Date.now() - 2 * 3600_000).toISOString();

function commit(n: number, fields: Partial<Commit> = {}): Commit {
  const person = { name: "Lucas", email: "lucas@example.org", at: AT };
  return {
    hash: `${n}`.padStart(40, "c"),
    parents: [`${n - 1}`.padStart(40, "c")],
    subject: `Commit ${n}`,
    body: "",
    author: person,
    committer: person,
    refs: [],
    renamed_from: null,
    ...fields,
  };
}

const HEAD = commit(3, {
  refs: [
    { name: "main", full: "refs/heads/main", kind: "branch", commit: "".padStart(40, "c") },
    { name: "v1", full: "refs/tags/v1", kind: "tag", commit: "".padStart(40, "c") },
  ],
});

function page(
  commits: Commit[],
  next: Schemas["HistoryNextJson"] | null = null,
  found: Schemas["FoundCommitJson"] | null = null,
): Schemas["HistoryJson"] {
  return {
    head: HEAD.hash,
    branch: "main",
    refs: [
      { name: "main", full: "refs/heads/main", kind: "branch", commit: HEAD.hash },
      { name: "feature", full: "refs/heads/feature", kind: "branch", commit: "f".repeat(40) },
      { name: "origin/main", full: "refs/remotes/origin/main", kind: "remote", commit: HEAD.hash },
      { name: "v1", full: "refs/tags/v1", kind: "tag", commit: HEAD.hash },
    ],
    commits,
    next,
    found,
    lines: null,
  };
}

function serveHistory(answer: (url: URL) => Response | Promise<Response>): Request[] {
  return serve({
    "GET /api/info": () => json(info()),
    "GET /api/repositories": () => json([repository("proj", [clone("proj")])]),
    "GET /api/history": (request) => answer(new URL(request.url)),
    // A path's uncommitted changes, above its commits.
    "GET /api/changes": () => json({ branch: null, groups: [], commit: null }),
  });
}

/** The View as a Panel holds it: with its parameters, shown as its address, and its title. */
function History({ initial }: { initial: Params }) {
  return <InPanel view={HistoryView} kind="history" params={initial} />;
}

const rows = () => listRows().map((row) => cells(row).join(" ").replace(/\s+/g, " ").trim());

afterEach(() => vi.unstubAllGlobals());

describe("the History View", () => {
  it("lists the commits newest first, with their refs, opening one's details", async () => {
    const merge = commit(2, {
      parents: ["1".padStart(40, "c"), "f".repeat(40)],
      body: "Why.\n\nAnd how.",
      committer: { name: "Someone", email: "else@example.org", at: AT },
    });
    serveHistory(() => json(page([{ ...HEAD, refs: page([]).refs.slice(0, 1) }, merge])));
    renderWithQueries(<History initial={{ clone: "clone-proj" }} />);
    await screen.findByText("Commit 3");
    await expectSettled();
    expect(rows()).toEqual([
      "ccccccc HEADmainCommit 3 Lucas 2h ago",
      "ccccccc Commit 2 Lucas 2h ago",
    ]);
    expect(screen.getByLabelText("merge")).toBeInTheDocument();
    // Named once the repositories are in, which may answer after the commits.
    await waitFor(() => expect(screen.getByRole("heading")).toHaveTextContent("History: proj"));
    expect(
      screen.getByRole("button", { name: "Branch, tag or commit: HEAD (main)" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByText("Commit 2"));
    const details = screen.getByRole("region", { name: "Commit details" });
    expect(within(details).getByText(/^Why\./)).toHaveTextContent("Why. And how.");
    expect(within(details).getByText("Someone <else@example.org>")).toBeInTheDocument();
    expect(within(details).getByText("parents")).toBeInTheDocument();
    // The parents' hashes, each with its Changes and Diff; its own is in the row above.
    expect(
      within(details).getAllByRole("button", { name: /^Changes in commit \w+$/ }),
    ).toHaveLength(2);
    expect(
      within(details).getAllByRole("button", { name: /^Diff of the changes in commit/ }),
    ).toHaveLength(2);
  });

  it("names no committer who wrote the commit, and the first commit's parents as none", async () => {
    serveHistory(() => json(page([commit(1, { parents: [] })])));
    renderWithQueries(<History initial={{ clone: "clone-proj" }} />);
    await userEvent.click(await screen.findByText("Commit 1"));
    const details = screen.getByRole("region", { name: "Commit details" });
    expect(within(details).queryByText("committer")).toBeNull();
    expect(within(details).getByText("committed")).toBeInTheDocument();
    expect(within(details).getByText("none: the first")).toBeInTheDocument();
  });

  it("shows a few of a commit's refs, main first, and all in its details", async () => {
    const { refs } = page([]);
    serveHistory(() => json(page([{ ...HEAD, refs: [...refs.slice(1), ...refs.slice(0, 1)] }])));
    renderWithQueries(<History initial={{ clone: "clone-proj" }} />);
    await screen.findByText("Commit 3");
    expect(rows()).toEqual(["ccccccc HEADmain+3Commit 3 Lucas 2h ago"]);
    expect(screen.getByText("+3")).toHaveAttribute("title", "feature, origin/main, v1");
    await userEvent.click(screen.getByText("Commit 3"));
    const details = screen.getByRole("region", { name: "Commit details" });
    expect(within(details).getByText("refs").nextSibling).toHaveTextContent(
      "mainfeatureorigin/mainv1",
    );
  });

  it("shows two labels of a row without HEAD, master first, then branches, the rest counted", async () => {
    const at = "".padStart(40, "c");
    const refs: Commit["refs"] = [
      { name: "v1", full: "refs/tags/v1", kind: "tag", commit: at },
      { name: "origin/x", full: "refs/remotes/origin/x", kind: "remote", commit: at },
      { name: "feature", full: "refs/heads/feature", kind: "branch", commit: at },
      { name: "master", full: "refs/heads/master", kind: "branch", commit: at },
    ];
    serveHistory(() => json(page([HEAD, commit(2, { refs })])));
    renderWithQueries(<History initial={{ clone: "clone-proj" }} />);
    await screen.findByText("Commit 2");
    expect(rows()[1]).toBe("ccccccc masterfeature+2Commit 2 Lucas 2h ago");
    expect(screen.getByText("+2")).toHaveAttribute("title", "origin/x, v1");
  });

  it("opens a commit's Changes and Diff from beside its hash, as previews", async () => {
    serveHistory(() => json(page([HEAD])));
    const opened: [Address, Opening | undefined][] = [];
    renderWithQueries(
      <OpenViewContext.Provider value={(address, opening) => opened.push([address, opening])}>
        <History initial={{ clone: "clone-proj" }} />
      </OpenViewContext.Provider>,
    );
    await screen.findByRole("button", { name: "Changes in commit ccccccc" });
    await expectSettled(); // all asked for came: no row drawn anew between finding and clicking
    await userEvent.click(screen.getByRole("button", { name: "Changes in commit ccccccc" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Diff of the changes in commit ccccccc" }),
    );
    const params = { clone: "clone-proj", commit: HEAD.hash };
    expect(opened).toEqual([
      [
        { kind: "changes", params },
        { beside: false, preview: true },
      ],
      [
        { kind: "diff", params },
        { beside: false, preview: true },
      ],
    ]);
    expect(screen.queryByRole("region")).toBeNull(); // the links open no details
  });

  it.each(["changes", "diff"])("marks the commit whose %s is shown", async (kind) => {
    serveHistory(() => json(page([HEAD, commit(2)])));
    const shownView = { kind, params: { clone: "clone-proj", commit: HEAD.hash } };
    renderWithQueries(
      <ShownContext value={new Set([addressText(shownView)])}>
        <History initial={{ clone: "clone-proj" }} />
      </ShownContext>,
    );
    const shown = (await screen.findByText("Commit 3")).closest("[data-showing]");
    expect(shown).not.toBeNull();
    expect(document.querySelectorAll("[data-showing]")).toHaveLength(1);
  });

  it("walks from a branch picked, and back from HEAD", async () => {
    const requests = serveHistory(() => json(page([HEAD])));
    renderWithQueries(<History initial={{ clone: "clone-proj" }} />);
    await screen.findByText("Commit 3");
    const pick = async (name: string) => {
      await userEvent.click(screen.getByRole("button", { name: /^Branch, tag or commit: / }));
      await userEvent.click(await screen.findByRole("option", { name }));
    };
    await pick("origin/main");
    expect(screen.getByRole("status")).toHaveTextContent(
      "history?clone=clone-proj&ref=refs%2Fremotes%2Forigin%2Fmain",
    );
    expect(screen.getByRole("heading")).toHaveTextContent("History: proj, origin/main");
    // Its own: the picker asks for commits too, and refetches may come after it.
    const walked = requests.map((request) => new URL(request.url).searchParams.get("ref"));
    expect(walked).toContain("refs/remotes/origin/main");
    await pick("HEAD (main)");
    expect(screen.getByRole("status")).toHaveTextContent(/^history\?clone=clone-proj$/);
  });

  it("offers HEAD when the branch is gone", async () => {
    const error =
      "the branch gone does not exist in this clone (git: fatal: Needed a single revision)";
    serveHistory(() => json({ error }, 400));
    renderWithQueries(<History initial={{ clone: "clone-proj", ref: "refs/heads/gone" }} />);
    expect(await screen.findByText(`Cannot show this: ${error}`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "From HEAD" }));
    expect(screen.getByRole("status")).toHaveTextContent(/^history\?clone=clone-proj$/);
  });

  it("shows a file's commits, where it was renamed, and all again", async () => {
    const renamed = commit(2, { renamed_from: "old/rows.ts" });
    serveHistory(() => json(page([HEAD, renamed, commit(1)])));
    renderWithQueries(<History initial={{ clone: "clone-proj", path: "src/rows.ts" }} />);
    await screen.findByText("Commit 3");
    expect(rows().slice(1, 4)).toEqual([
      expect.stringContaining("Commit 2"),
      "renamed from old/rows.ts",
      expect.stringContaining("Commit 1"),
    ]);
    expect(screen.getByRole("heading")).toHaveTextContent("History: rows.ts");
    await userEvent.click(screen.getByRole("button", { name: "Show all commits" }));
    expect(screen.getByRole("status")).toHaveTextContent(/^history\?clone=clone-proj$/);
  });

  it("loads older commits on scrolling to the end, going on where the page ended", async () => {
    const scrolledToEnd = endOfList();
    const next = { start: HEAD.hash, path: "old.ts", skip: 0 };
    const requests = serveHistory((url) =>
      url.searchParams.has("start") ? json(page([commit(1)])) : json(page([HEAD], next)),
    );
    renderWithQueries(<History initial={{ clone: "clone-proj", path: "new.ts" }} />);
    expect(await screen.findByText("Older commits load as you scroll.")).toBeInTheDocument();
    act(() => scrolledToEnd());
    expect(await screen.findByText("Commit 1")).toBeInTheDocument();
    // The last request for older ones: a refetch may come after it.
    const older = new URL(requests.findLast((r) => r.url.includes("start="))?.url ?? "")
      .searchParams;
    expect([older.get("start"), older.get("path"), older.get("skip")]).toEqual([
      HEAD.hash,
      "old.ts",
      "0",
    ]);
  });

  it("asks for the next page with neither start nor path where it names none", async () => {
    const scrolledToEnd = endOfList();
    const next = { start: null, path: null, skip: 50 };
    const requests = serveHistory((url) =>
      url.searchParams.has("skip") ? json(page([commit(1)])) : json(page([HEAD], next)),
    );
    renderWithQueries(<History initial={{ clone: "clone-proj" }} />);
    expect(await screen.findByText("Older commits load as you scroll.")).toBeInTheDocument();
    act(() => scrolledToEnd());
    expect(await screen.findByText("Commit 1")).toBeInTheDocument();
    // The last request for the next page: a refetch may come after it.
    const older = new URL(requests.findLast((r) => r.url.includes("skip="))?.url ?? "")
      .searchParams;
    expect([older.has("start"), older.has("path"), older.get("skip")]).toEqual([
      false,
      false,
      "50",
    ]);
  });

  it("says what is not committed above HEAD's commits, of all files or the path", async () => {
    serve({
      "GET /api/info": () => json(info()),
      "GET /api/repositories": () =>
        json([repository("proj", [clone("proj", { staged: 2, changed: 1, untracked: 3 })])]),
      "GET /api/history": () => json(page([HEAD])),
      "GET /api/changes": () =>
        json({
          branch: null,
          commit: null,
          groups: [{ name: "unstaged", from: "index", to: "working-tree", changes: [], count: 1 }],
        }),
    });
    const opened: Address[] = [];
    renderWithQueries(
      <OpenViewContext.Provider value={(address) => opened.push(address)}>
        <History initial={{ clone: "clone-proj" }} />
      </OpenViewContext.Provider>,
    );
    expect(
      await screen.findByText("Uncommitted: 2 staged, 1 changed, 3 untracked"),
    ).toBeInTheDocument();
    await expectSettled(); // all asked for came: no row drawn anew between finding and clicking
    await userEvent.click(screen.getByRole("button", { name: "Uncommitted changes" }));
    await userEvent.click(screen.getByRole("button", { name: "Diff of the uncommitted changes" }));
    expect(opened).toEqual([
      { kind: "changes", params: { clone: "clone-proj" } },
      { kind: "diff", params: { clone: "clone-proj", from: "HEAD", to: "working-tree" } },
    ]);
    await userEvent.click(screen.getByRole("button", { name: /^Branch, tag or commit: / }));
    await userEvent.click(await screen.findByRole("option", { name: "feature" }));
    // Not what is checked out, once its commits are in: until then, those of HEAD stay, dimmed.
    await waitFor(() => expect(screen.queryByText(/^Uncommitted/)).toBeNull());
  });

  it("searches the messages for all words typed, without what is not committed", async () => {
    exactRequests(); // counts what it asks
    const found = commit(2, { subject: "Mark rows whose view is shown" });
    const requests = serve({
      "GET /api/info": () => json(info()),
      "GET /api/repositories": () => json([repository("proj", [clone("proj", { changed: 1 })])]),
      "GET /api/history": (request) => {
        const search = new URL(request.url).searchParams.get("search");
        if (search === null) return json(page([HEAD]));
        return json(page(search === "row view" ? [found] : []));
      },
    });
    renderWithQueries(<History initial={{ clone: "clone-proj" }} />);
    expect(await screen.findByText("Uncommitted: 1 changed")).toBeInTheDocument();
    const field = screen.getByRole("searchbox", { name: "Search hashes or messages" });
    await userEvent.type(field, "row");
    await act(() => new Promise((resolve) => setTimeout(resolve, 350))); // a pause: asked
    await userEvent.type(field, "  view");
    expect(field).toHaveValue("row  view"); // no key lost
    expect(await screen.findByText("Mark rows whose view is shown")).toBeInTheDocument();
    expect(screen.queryByText(/^Uncommitted/)).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("history?clone=clone-proj&search=row");
    expect(screen.getByRole("heading")).toHaveTextContent("History: proj, “row view”");
    const searches = () =>
      requests
        .map((request) => new URL(request.url))
        .filter((url) => url.pathname === "/api/history")
        .map((url) => url.searchParams.get("search"));
    expect(searches()).toEqual([null, "row", "row view"]); // each time typing paused
    await userEvent.clear(field);
    await userEvent.type(field, "zebra yak{Enter}");
    // Enter asks at once, without waiting for a pause.
    await waitFor(() => expect(searches()).toContain("zebra yak"), { timeout: 200 });
    expect(await screen.findByText("No commits mention zebra and yak.")).toBeInTheDocument();
    await userEvent.type(field, "{Escape}");
    expect(await screen.findByText("Uncommitted: 1 changed")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/^history\?clone=clone-proj$/);
  });

  it("finds a commit by its hash: listed first, or where it is, to show it there", async () => {
    const aside = commit(7, { subject: "Aside" });
    const feature = {
      name: "feature",
      full: "refs/heads/feature",
      kind: "branch" as const,
      commit: aside.hash,
    };
    let answer = () => {};
    const answered = new Promise<void>((resolve) => {
      answer = resolve;
    });
    serveHistory(async (url) => {
      const search = url.searchParams.get("search");
      if (search === null) return json(page([HEAD]));
      if (url.searchParams.get("ref") === "refs/heads/feature") {
        await answered;
        return json(page([], null, { commit: aside, where: "listed", refs: [] }));
      }
      if (url.searchParams.get("path") !== null) {
        return json(page([], null, { commit: aside, where: "path", refs: [] }));
      }
      return json(page([], null, { commit: aside, where: "refs", refs: [feature] }));
    });
    renderWithQueries(<History initial={{ clone: "clone-proj", search: "ccccccc7" }} />);
    expect(await screen.findByText("not on main, but on:")).toBeInTheDocument();
    expect(screen.getByText("Aside")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "feature" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "history?clone=clone-proj&ref=refs%2Fheads%2Ffeature&search=ccccccc7",
    );
    // Until it answers, the rows before stay, saying what they said.
    expect(screen.getByText("not on main, but on:")).toBeInTheDocument();
    answer();
    // There, listed: as one of its commits.
    await waitFor(() => expect(screen.queryByText("not on main, but on:")).toBeNull());
    expect(rows()).toEqual(["ccccccc Aside Lucas 2h ago"]);
  });

  it("says of a commit found by its hash where no branch or tag leads, or a few that do", async () => {
    const aside = commit(7, { subject: "Aside" });
    const branch = (name: string) => ({
      name,
      full: `refs/heads/${name}`,
      kind: "branch" as const,
      commit: aside.hash,
    });
    const on = ["a", "b", "c", "d"].map(branch);
    serveHistory((url) =>
      json(
        url.searchParams.get("search") === "ccccccc7"
          ? page([], null, { commit: aside, where: "refs", refs: on })
          : page([], null, { commit: aside, where: "none", refs: [] }),
      ),
    );
    const { unmount } = renderWithQueries(
      <History initial={{ clone: "clone-proj", search: "ccccccc7" }} />,
    );
    expect(await screen.findByText("not on main, but on:")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^[abcd]$/ }).map((b) => b.textContent)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(screen.getByText("+1 more")).toHaveAttribute("title", "d");
    unmount();
    renderWithQueries(<History initial={{ clone: "clone-proj", search: "cccccc7" }} />);
    expect(await screen.findByText("no branch or tag leads to it any more")).toBeInTheDocument();
  });

  it("offers all files for a commit found by its hash that does not change the path", async () => {
    const aside = commit(7, { subject: "Aside" });
    serveHistory((url) =>
      json(
        url.searchParams.get("path") === null
          ? page([], null, { commit: aside, where: "listed", refs: [] })
          : page([], null, { commit: aside, where: "path", refs: [] }),
      ),
    );
    renderWithQueries(
      <History initial={{ clone: "clone-proj", path: "a.txt", search: "ccccccc7" }} />,
    );
    expect(await screen.findByText("does not change a.txt")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "All files" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      /^history\?clone=clone-proj&search=ccccccc7$/,
    );
  });

  it("says what is not committed of the path", async () => {
    serve({
      "GET /api/info": () => json(info()),
      "GET /api/repositories": () => json([repository("proj", [clone("proj", { staged: 2 })])]),
      "GET /api/history": () => json(page([HEAD])),
      "GET /api/changes": () =>
        json({
          branch: null,
          commit: null,
          groups: [{ name: "unstaged", from: "index", to: "working-tree", changes: [], count: 1 }],
        }),
    });
    renderWithQueries(<History initial={{ clone: "clone-proj", path: "a.txt" }} />);
    expect(await screen.findByText("Uncommitted: 1 changed")).toBeInTheDocument();
  });

  it("keeps the elements of its rows when its queries are fetched again", async () => {
    serve({
      "GET /api/info": () => json(info()),
      "GET /api/repositories": () => json([repository("proj", [clone("proj", { staged: 2 })])]),
      "GET /api/history": () => json(page([HEAD])),
    });
    const { client } = renderWithQueries(<History initial={{ clone: "clone-proj" }} />);
    const uncommitted = await screen.findByText("Uncommitted: 2 staged");
    const subject = screen.getByText("Commit 3");
    await act(() => client.invalidateQueries()); // as a live hint does
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(screen.getByText("Uncommitted: 2 staged")).toBe(uncommitted);
    expect(screen.getByText("Commit 3")).toBe(subject);
  });

  it("says when there are none", async () => {
    serveHistory(() => json({ head: null, branch: null, refs: [], commits: [], next: null }));
    renderWithQueries(<History initial={{ clone: "clone-proj" }} />);
    expect(await screen.findByText("No commits yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Branch, tag or commit: HEAD" })).toBeInTheDocument();
  });

  const nodes = () =>
    [...document.querySelectorAll("svg[data-node]")].map((node) => node.getAttribute("data-node"));

  it("draws the graph of the commits: HEAD, merges and commits", async () => {
    const merge = commit(2, { parents: ["1".padStart(40, "c"), "f".repeat(40)] });
    const side = commit(9, { hash: "f".repeat(40), parents: ["1".padStart(40, "c")] });
    serveHistory(() => json(page([HEAD, merge, side, commit(1, { parents: [] })])));
    renderWithQueries(<History initial={{ clone: "clone-proj" }} />);
    await screen.findByText("Commit 1");
    expect(screen.getByText("graph")).toBeInTheDocument();
    expect(nodes()).toEqual(["head", "merge", "commit", "commit"]);
  });

  it("fits the graph column to its lanes, one lane as narrow as it needs", async () => {
    serveHistory(() => json(page([HEAD, commit(2), commit(1, { parents: [] })])));
    renderWithQueries(<History initial={{ clone: "clone-proj" }} />);
    await screen.findByText("Commit 1");
    const grid = document.querySelector<HTMLElement>("[style*='--columns']");
    // After the square, the graph: one lane of 12 px and half a lane of room.
    expect(grid?.style.getPropertyValue("--columns")).toMatch(/^var\(--square\) 18px /);
  });

  it("draws no graph for a path or a search, which leave commits out between", async () => {
    serveHistory(() => json(page([HEAD, commit(2), commit(1)])));
    const { unmount } = renderWithQueries(
      <History initial={{ clone: "clone-proj", path: "src/rows.ts" }} />,
    );
    await screen.findByText("Commit 1");
    expect(nodes()).toEqual([]);
    expect(screen.queryByText("graph")).toBeNull();
    unmount();
    renderWithQueries(<History initial={{ clone: "clone-proj", search: "Commit" }} />);
    await screen.findByText("Commit 1");
    expect(nodes()).toEqual([]);
  });

  it("hides the graph from the header menu, which never moves it", async () => {
    serveHistory(() => json(page([HEAD, commit(2)])));
    renderWithQueries(<History initial={{ clone: "clone-proj" }} />);
    await screen.findByText("Commit 2");
    fireEvent.contextMenu(screen.getByText("graph"));
    const menu = screen.getByRole("menu", { name: "Columns" });
    for (const side of ["left", "right"]) {
      expect(within(menu).getByRole("menuitem", { name: `Move "graph" ${side}` })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    }
    await userEvent.keyboard("{Escape}");
    fireEvent.contextMenu(
      screen.getByText("commit", { selector: "[data-column] *, [data-column]" }),
    );
    expect(screen.getByRole("menuitem", { name: 'Move "commit" left' })).toHaveAttribute(
      "aria-disabled",
      "true", // past the graph is no place to go: it stays after the square
    );
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "graph" }));
    expect(nodes()).toEqual([]);
    expect(localStorage.getItem("hephaistos.lists.history.hidden")).toBe('["graph"]');
  });

  it("asks for commits by date, or topologically once toggled, keeping it in the address", async () => {
    const requests = serveHistory(() => json(page([HEAD, commit(2)])));
    renderWithQueries(<History initial={{ clone: "clone-proj" }} />);
    await screen.findByText("Commit 2");
    const order = () => orderAsked(requests);
    expect(order()).toBe("date");
    const toggle = screen.getByRole("button", { name: "Topological order" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(toggle);
    expect(screen.getByRole("status")).toHaveTextContent("history?clone=clone-proj&order=topo");
    await waitFor(() => expect(order()).toBe("topo"));
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(toggle);
    expect(screen.getByRole("status")).toHaveTextContent(/^history\?clone=clone-proj$/);
    expect(toggle).toHaveAttribute("aria-pressed", "false"); // by date, as asked for before
  });

  it("takes an order it does not know as by date", async () => {
    const requests = serveHistory(() => json(page([HEAD])));
    renderWithQueries(<History initial={{ clone: "clone-proj", order: "author" }} />);
    await screen.findByText("Commit 3");
    expect(orderAsked(requests)).toBe("date");
  });
});

/** The order the last request for commits asked for. */
function orderAsked(requests: Request[]): string | null {
  const asked = requests.filter((request) => request.url.includes("/api/history")).at(-1);
  return new URL(asked?.url ?? "http://none").searchParams.get("order");
}

describe("the History View of a Checkout gone", () => {
  it("says so, and keeps saying it while asking again", async () => {
    const checkout = { clone: "clone-proj", worktree: "wt-side", gone: "worktree" } as const;
    const gone = () => json({ error: "the worktree at ~/side was removed", checkout }, 410);
    let answer = (): Response | Promise<Response> => gone();
    serve({
      "GET /api/info": () => json(info()),
      "GET /api/repositories": () => json([repository("proj", [clone("proj")])]),
      "GET /api/history": () => answer(),
    });
    const { client } = renderWithQueries(<History initial={{ worktree: "wt-side" }} />);
    expect(await screen.findByText(/^The worktree at ~\/side was removed\.$/)).toBeInTheDocument();
    expect(screen.queryByRole("treegrid")).toBeNull();
    let reply = (_: Response) => {};
    answer = () => new Promise((resolve) => (reply = resolve));
    await act(async () => {
      void client.invalidateQueries(); // answered below
      await new Promise((resolve) => setTimeout(resolve, 50)); // the View updated meanwhile
    });
    expect(screen.getByText(/was removed/)).toBeInTheDocument();
    expect(screen.queryByRole("treegrid")).toBeNull();
    await act(async () => reply(gone()));
    expect(screen.getByText(/was removed/)).toBeInTheDocument();
  });
});
