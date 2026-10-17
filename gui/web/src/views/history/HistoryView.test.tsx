import { act, screen, within } from "@testing-library/react";
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
    { name: "main", kind: "branch", commit: "".padStart(40, "c") },
    { name: "v1", kind: "tag", commit: "".padStart(40, "c") },
  ],
});

function page(
  commits: Commit[],
  next: Schemas["HistoryNextJson"] | null = null,
): Schemas["HistoryJson"] {
  return {
    head: HEAD.hash,
    branch: "main",
    refs: [
      { name: "main", kind: "branch", commit: HEAD.hash },
      { name: "feature", kind: "branch", commit: "f".repeat(40) },
      { name: "origin/main", kind: "remote", commit: HEAD.hash },
      { name: "v1", kind: "tag", commit: HEAD.hash },
    ],
    commits,
    next,
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
    expect(screen.getByRole("combobox", { name: "Commits from" })).toHaveDisplayValue(
      "HEAD (main)",
    );
    await userEvent.click(screen.getByText("Commit 2"));
    const details = screen.getByRole("region", { name: "Commit details" });
    expect(within(details).getByText(/^Why\./)).toHaveTextContent("Why. And how.");
    expect(within(details).getByText("Someone <else@example.org>")).toBeInTheDocument();
    expect(within(details).getByText("parents")).toBeInTheDocument();
    // The parents' hashes; its own is in the row above.
    expect(within(details).getAllByRole("button", { name: /^Changes of / })).toHaveLength(2);
  });

  it("opens a commit's changes from its hash, beside as a preview", async () => {
    serveHistory(() => json(page([HEAD])));
    const opened: [Address, Opening | undefined][] = [];
    renderWithQueries(
      <OpenViewContext.Provider value={(address, opening) => opened.push([address, opening])}>
        <History initial={{ clone: "clone-proj" }} />
      </OpenViewContext.Provider>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Changes of ccccccc" }));
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
    const choice = await screen.findByRole("combobox", { name: "Commits from" });
    await screen.findByText("Commit 3");
    expect(
      within(choice)
        .getAllByRole("group")
        .map((group) => group.getAttribute("label")),
    ).toEqual(["Branches", "Remote branches", "Tags"]);
    await userEvent.selectOptions(choice, "origin/main");
    expect(screen.getByRole("status")).toHaveTextContent(
      "history?clone=clone-proj&ref=origin%2Fmain",
    );
    expect(screen.getByRole("heading")).toHaveTextContent("History: proj, origin/main");
    expect(new URL(requests.at(-1)?.url ?? "").searchParams.get("ref")).toBe("origin/main");
    await userEvent.selectOptions(choice, "");
    expect(screen.getByRole("status")).toHaveTextContent(/^history\?clone=clone-proj$/);
  });

  it("offers HEAD when the branch is gone", async () => {
    serveHistory(() => json({ error: "'gone' is no branch, tag or commit here" }, 400));
    renderWithQueries(<History initial={{ clone: "clone-proj", ref: "gone" }} />);
    expect(await screen.findByText(/No answer: 'gone' is no branch/)).toBeInTheDocument();
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
    await userEvent.click(
      screen.getByRole("button", { name: "All commits, not only those that changed src/rows.ts" }),
    );
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
          groups: [{ name: "unstaged", from: "index", to: "worktree", changes: [], count: 1 }],
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
    await userEvent.click(screen.getByRole("button", { name: "Changes not committed" }));
    expect(opened).toEqual([{ kind: "changes", params: { clone: "clone-proj" } }]);
    await userEvent.selectOptions(screen.getByRole("combobox"), "feature");
    expect(screen.queryByText(/^Uncommitted/)).toBeNull(); // not what is checked out
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
          groups: [{ name: "unstaged", from: "index", to: "worktree", changes: [], count: 1 }],
        }),
    });
    renderWithQueries(<History initial={{ clone: "clone-proj", path: "a.txt" }} />);
    expect(await screen.findByText("Uncommitted: 1 changed")).toBeInTheDocument();
  });

  it("says when there are none", async () => {
    serveHistory(() => json({ head: null, branch: null, refs: [], commits: [], next: null }));
    renderWithQueries(<History initial={{ clone: "clone-proj" }} />);
    expect(await screen.findByText("No commits yet.")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Commits from" })).toHaveDisplayValue("HEAD");
  });
});
