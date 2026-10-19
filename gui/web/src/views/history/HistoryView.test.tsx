import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Schemas } from "../../api/client";
import { cells } from "../../test/list";
import { clone, info, json, renderWithQueries, repository, serve } from "../../test/server";
import { type Address, addressText, type Params } from "../address";
import { type Opening, OpenViewContext, ShownContext } from "../opening";
import { HistoryView } from "./HistoryView";
import type { Commit } from "./rows";

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
  };
}

function serveHistory(answer: (url: URL) => Response): Request[] {
  return serve({
    "GET /api/info": () => json(info()),
    "GET /api/repositories": () => json([repository("proj", [clone("proj")])]),
    "GET /api/history": (request) => answer(new URL(request.url)),
  });
}

/** The View as a Panel holds it: with its parameters, shown as its address, and its title. */
function History({ initial }: { initial: Params }) {
  const [params, setParams] = useState<Params>(initial);
  const [title, setTitle] = useState("");
  return (
    <>
      <output>{addressText({ kind: "history", params })}</output>
      <h1>{title}</h1>
      <HistoryView params={params} setParams={setParams} setTitle={setTitle} />
    </>
  );
}

const rows = () =>
  screen.getAllByRole("listitem").map((row) => cells(row).join(" ").replace(/\s+/g, " ").trim());

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
    expect(rows()).toEqual([
      "ccccccc HEADmainCommit 3 Lucas 2h ago",
      "ccccccc Commit 2 Lucas 2h ago",
    ]);
    expect(screen.getByLabelText("merge")).toBeInTheDocument();
    expect(screen.getByRole("heading")).toHaveTextContent("History: proj");
    expect(
      screen.getByRole("button", { name: "Branch, tag or commit: HEAD (main)" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByText("Commit 2"));
    const details = screen.getByRole("region", { name: "Commit details" });
    expect(within(details).getByText(/^Why\./)).toHaveTextContent("Why. And how.");
    expect(within(details).getByText("Someone <else@example.org>")).toBeInTheDocument();
    expect(within(details).getByText("parents")).toBeInTheDocument();
    // The parents' hashes; its own is in the row above.
    expect(within(details).getAllByRole("button", { name: /^Changes in commit / })).toHaveLength(2);
  });

  it("opens a commit's changes from its hash, beside as a preview", async () => {
    serveHistory(() => json(page([HEAD])));
    const opened: [Address, Opening | undefined][] = [];
    renderWithQueries(
      <OpenViewContext.Provider value={(address, opening) => opened.push([address, opening])}>
        <History initial={{ clone: "clone-proj" }} />
      </OpenViewContext.Provider>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Changes in commit ccccccc" }));
    expect(opened).toEqual([
      [
        { kind: "changes", params: { clone: "clone-proj", commit: HEAD.hash } },
        { beside: true, preview: true },
      ],
    ]);
    expect(screen.queryByRole("region")).toBeNull(); // the hash opens no details
  });

  it("marks the commit whose changes are shown", async () => {
    serveHistory(() => json(page([HEAD, commit(2)])));
    const changes = { kind: "changes", params: { clone: "clone-proj", commit: HEAD.hash } };
    renderWithQueries(
      <ShownContext value={new Set([addressText(changes)])}>
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
    expect(new URL(requests.at(-1)?.url ?? "").searchParams.get("ref")).toBe(
      "refs/remotes/origin/main",
    );
    await pick("HEAD (main)");
    expect(screen.getByRole("status")).toHaveTextContent(/^history\?clone=clone-proj$/);
  });

  it("offers HEAD when the branch is gone", async () => {
    serveHistory(() => json({ error: "'gone' is not a branch, tag or commit here" }, 400));
    renderWithQueries(<History initial={{ clone: "clone-proj", ref: "gone" }} />);
    expect(await screen.findByText(/Couldn't load: 'gone' is not a branch/)).toBeInTheDocument();
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
    let scrolledToEnd = () => {};
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(seen: IntersectionObserverCallback) {
          scrolledToEnd = () =>
            seen([{ isIntersecting: true }] as IntersectionObserverEntry[], this as never);
        }
        observe() {}
        disconnect() {}
      },
    );
    const next = { start: HEAD.hash, path: "old.ts", skip: 0 };
    const requests = serveHistory((url) =>
      url.searchParams.has("start") ? json(page([commit(1)])) : json(page([HEAD], next)),
    );
    renderWithQueries(<History initial={{ clone: "clone-proj", path: "new.ts" }} />);
    expect(await screen.findByText("Older commits load as you scroll.")).toBeInTheDocument();
    act(() => scrolledToEnd());
    expect(await screen.findByText("Commit 1")).toBeInTheDocument();
    const older = new URL(requests.at(-1)?.url ?? "").searchParams;
    expect([older.get("start"), older.get("path"), older.get("skip")]).toEqual([
      HEAD.hash,
      "old.ts",
      "0",
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
    await userEvent.click(screen.getByRole("button", { name: "Uncommitted changes" }));
    expect(opened).toEqual([{ kind: "changes", params: { clone: "clone-proj" } }]);
    await userEvent.click(screen.getByRole("button", { name: /^Branch, tag or commit: / }));
    await userEvent.click(await screen.findByRole("option", { name: "feature" }));
    expect(screen.queryByText(/^Uncommitted/)).toBeNull(); // not what is checked out
  });

  it("searches the messages for all words typed, without what is not committed", async () => {
    const found = commit(2, { subject: "Mark rows whose View is shown" });
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
    expect(await screen.findByText("Mark rows whose View is shown")).toBeInTheDocument();
    expect(screen.queryByText(/^Uncommitted/)).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("history?clone=clone-proj&search=row");
    expect(screen.getByRole("heading")).toHaveTextContent("History: proj, “row view”");
    const asked = requests.map((request) => new URL(request.url));
    expect(
      asked
        .filter((url) => url.pathname === "/api/history")
        .map((url) => url.searchParams.get("search")),
    ).toEqual([null, "row", "row view"]); // each time typing paused
    await userEvent.clear(field);
    await userEvent.type(field, "zebra yak{Enter}");
    // Enter asks at once, without waiting for a pause.
    expect(
      await screen.findByText("No commits mention zebra and yak.", {}, { timeout: 200 }),
    ).toBeInTheDocument();
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
    serveHistory((url) => {
      const search = url.searchParams.get("search");
      if (search === null) return json(page([HEAD]));
      if (url.searchParams.get("ref") === "refs/heads/feature") {
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
    // There, listed: as one of its commits.
    await waitFor(() => expect(screen.queryByText("not on main, but on:")).toBeNull());
    expect(rows()).toEqual(["ccccccc Aside Lucas 2h ago"]);
  });

  it("offers all files for a commit found by its hash that doesn't change the path", async () => {
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
    expect(await screen.findByText("doesn't change a.txt")).toBeInTheDocument();
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

  it("says when there are none", async () => {
    serveHistory(() => json({ head: null, branch: null, refs: [], commits: [], next: null }));
    renderWithQueries(<History initial={{ clone: "clone-proj" }} />);
    expect(await screen.findByText("No commits yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Branch, tag or commit: HEAD" })).toBeInTheDocument();
  });
});
