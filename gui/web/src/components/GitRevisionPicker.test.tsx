import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Schemas } from "../api/client";
import { json, renderWithQueries, serve } from "../test/server";
import {
  type FixedRow,
  GitRevisionPicker,
  matchRank,
  type PickerTab,
  pickedText,
  tabOf,
} from "./GitRevisionPicker";

type Commit = Schemas["CommitJson"];

const AT = new Date().toISOString();

function commit(n: number, subject = `Commit ${n}`): Commit {
  const person = { name: "Lucas", email: "lucas@example.org", at: AT };
  return {
    hash: `${n}`.padStart(40, "c"),
    parents: [],
    subject,
    body: "",
    author: person,
    committer: person,
    refs: [],
    renamed_from: null,
  };
}

const HEAD_HASH = commit(3).hash;
const REFS: Schemas["RefJson"][] = [
  { name: "main", full: "refs/heads/main", kind: "branch", commit: HEAD_HASH },
  { name: "index", full: "refs/heads/index", kind: "branch", commit: HEAD_HASH },
  { name: "feature", full: "refs/heads/feature", kind: "branch", commit: HEAD_HASH },
  { name: "origin/main", full: "refs/remotes/origin/main", kind: "remote", commit: HEAD_HASH },
  ...[7, 6, 5, 4, 3, 2, 1].map((n) => ({
    name: `v${n}`,
    full: `refs/tags/v${n}`,
    kind: "tag" as const,
    commit: HEAD_HASH,
  })),
];

function page(
  commits: Commit[],
  next: Schemas["HistoryNextJson"] | null = null,
  found: Schemas["FoundCommitJson"] | null = null,
): Schemas["HistoryJson"] {
  return { head: HEAD_HASH, branch: "main", refs: REFS, commits, next, found };
}

function serveHistory(answer: (url: URL) => Response): Request[] {
  return serve({ "GET /api/history": (request) => answer(new URL(request.url)) });
}

function Picker({
  initial = "HEAD",
  rows = ["working-tree", "index", "HEAD"],
  tabs = ["branches", "tags", "commits"],
}: {
  initial?: string;
  rows?: FixedRow[];
  tabs?: PickerTab[];
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <output>{value}</output>
      <GitRevisionPicker
        checkout={{ clone: "clone-proj" }}
        label="Revision"
        value={value}
        onChange={setValue}
        rows={rows}
        tabs={tabs}
        commitsFrom="everywhere"
      />
    </>
  );
}

// A row's parts, a space apart: `ccccccc Commit 3`.
const options = () =>
  screen
    .getAllByRole("option")
    .map((option) =>
      [...option.querySelectorAll("span")].map((part) => part.textContent).join(" "),
    );

async function openPicker() {
  await userEvent.click(screen.getByRole("button", { name: /^Revision: / }));
  return screen.findByRole("searchbox");
}

const selectedTab = () => screen.getByRole("tab", { selected: true }).textContent;

describe("GitRevisionPicker", () => {
  it("opens on All for a fixed row: those rows, then a few of each kind, leading to more", async () => {
    serveHistory(() => json(page([commit(3)])));
    renderWithQueries(<Picker />);
    expect(screen.getByRole("button", { name: "Revision: HEAD" })).toBeInTheDocument();
    await openPicker();
    await waitFor(() => expect(options()).toContain("main"));
    expect(selectedTab()).toMatch(/^All/);
    expect(options()).toEqual([
      "Working tree",
      "Staged (index)",
      "HEAD (main)",
      "main",
      "index",
      "feature",
      "origin/main",
      "v7",
      "v6",
      "v5",
      "v4",
      "v3",
      "… 2 more tags",
      "ccccccc Commit 3",
    ]);
    await userEvent.click(screen.getByRole("option", { name: "… 2 more tags" }));
    expect(selectedTab()).toBe("Tags 7");
    await waitFor(() => expect(options()).toContain("v1"));
    await userEvent.click(screen.getByRole("option", { name: "v1" }));
    expect(screen.getByRole("status")).toHaveTextContent(/^refs\/tags\/v1$/);
    expect(screen.getByRole("button", { name: "Revision: v1" })).toBeInTheDocument();
  });

  it("picks a branch by its full name, never mistaken for the index", async () => {
    serveHistory(() => json(page([commit(3)])));
    renderWithQueries(<Picker />);
    await openPicker();
    await userEvent.click(screen.getByRole("tab", { name: /^Branches/ }));
    await waitFor(() =>
      expect(options()).toEqual([
        "Working tree",
        "Staged (index)",
        "HEAD (main)",
        "main",
        "index",
        "feature",
        "origin/main",
      ]),
    );
    await userEvent.click(screen.getByRole("option", { name: "index" }));
    expect(screen.getByRole("status")).toHaveTextContent(/^refs\/heads\/index$/);
  });

  it("opens on the tab of what is picked; Ctrl+arrows switch tabs", async () => {
    serveHistory(() => json(page([commit(3)])));
    renderWithQueries(<Picker initial="refs/tags/v1" rows={[]} />);
    await openPicker();
    await waitFor(() => expect(selectedTab()).toMatch(/^Tags/));
    await waitFor(() => expect(options()).toEqual(["v7", "v6", "v5", "v4", "v3", "v2", "v1"]));
    await userEvent.keyboard("{Control>}{ArrowRight}{/Control}");
    expect(selectedTab()).toMatch(/^Commits/);
    await userEvent.keyboard("{Control>}{ArrowRight}{/Control}");
    expect(selectedTab()).toMatch(/^All/);
    await userEvent.keyboard("{Control>}{ArrowLeft}{/Control}");
    expect(selectedTab()).toMatch(/^Commits/);
  });

  it("shows All on typing, the best matches first, and the tab browsed on clearing", async () => {
    serveHistory(() => json(page([commit(3)])));
    renderWithQueries(<Picker initial="refs/tags/v1" rows={[]} tabs={["branches", "tags"]} />);
    const field = await openPicker();
    await waitFor(() => expect(selectedTab()).toMatch(/^Tags/));
    await userEvent.type(field, "IN");
    expect(selectedTab()).toMatch(/^All/);
    // Starting with it, before having it within.
    expect(options()).toEqual(["index", "main", "origin/main"]);
    await userEvent.clear(field);
    expect(selectedTab()).toMatch(/^Tags/);
    await userEvent.type(field, "main");
    // Named so exactly, on top, so that Enter picks it.
    expect(options()).toEqual(["main", "origin/main"]);
    expect(screen.getByText("Top match")).toBeInTheDocument();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("status")).toHaveTextContent(/^refs\/heads\/main$/);
  });

  it("picks the first row on Enter where none is focused, e.g. after switching tabs", async () => {
    serveHistory(() => json(page([commit(3)])));
    renderWithQueries(<Picker rows={[]} tabs={["branches", "tags"]} />);
    const field = await openPicker();
    await waitFor(() => expect(options()).toContain("main"));
    await userEvent.type(field, "v");
    await userEvent.keyboard("{Control>}{ArrowLeft}{/Control}");
    expect(selectedTab()).toBe("Tags 7");
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("status")).toHaveTextContent(/^refs\/tags\/v7$/);
  });

  it("searches commits on the server, everywhere, a hash's commit on top", async () => {
    const aside = commit(7, "Aside");
    const requests = serveHistory((url) =>
      url.searchParams.get("search") === "fix"
        ? json(page([commit(5, "Fix it")], null, { commit: aside, where: "refs", refs: [] }))
        : json(page([commit(3)])),
    );
    renderWithQueries(<Picker rows={[]} tabs={["commits"]} />);
    const field = await openPicker();
    await waitFor(() => expect(options()).toEqual(["ccccccc Commit 3"]));
    expect(new URL(requests[0]?.url ?? "").searchParams.get("everywhere")).toBe("true");
    await userEvent.type(field, "fix");
    await waitFor(() => expect(options()).toEqual(["ccccccc Aside", "ccccccc Fix it"]));
    expect(screen.getByText("Top match")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("option", { name: /Fix it/ }));
    expect(screen.getByRole("status")).toHaveTextContent(commit(5).hash);
    expect(screen.getByRole("button", { name: "Revision: ccccccc" })).toBeInTheDocument();
  });

  it("resolves what is typed on Enter when no row matches, or says why not", async () => {
    const requests = serveHistory((url) => {
      const ref = url.searchParams.get("ref");
      if (ref === "HEAD~2") return json(page([commit(1)]));
      if (ref !== null) return json({ error: `${ref} is not a branch, tag or commit here` }, 400);
      return json(page([commit(3)]));
    });
    renderWithQueries(<Picker rows={[]} tabs={["branches", "tags"]} />);
    const field = await openPicker();
    await waitFor(() => expect(options()).toContain("main"));
    await userEvent.type(field, "nope{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "nope is not a branch, tag or commit here",
    );
    await userEvent.clear(field);
    await userEvent.type(field, "HEAD~2{Enter}");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(commit(1).hash));
    // Without commits to offer, none searched for.
    expect(requests.some((request) => new URL(request.url).searchParams.has("search"))).toBe(false);
  });

  it("searches at once on Enter, never picking a commit of the search before", async () => {
    serveHistory((url) => {
      if (url.searchParams.get("ref") === "HEAD~2") return json(page([commit(1)]));
      return json(page(url.searchParams.has("search") ? [] : [commit(3)]));
    });
    renderWithQueries(<Picker rows={[]} tabs={["commits"]} />);
    const field = await openPicker();
    await waitFor(() => expect(options()).toEqual(["ccccccc Commit 3"]));
    await userEvent.type(field, "HEAD~2{Enter}");
    // Still open, so what is behind is hidden; nothing picked.
    expect(screen.getByRole("status", { hidden: true })).toHaveTextContent(/^HEAD$/);
    expect(await screen.findByText("Nothing matches.")).toBeInTheDocument();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(commit(1).hash));
  });

  it("leads from All to the commits, loading older ones on scrolling to the end", async () => {
    let scrolledToEnd = () => {};
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(seen: IntersectionObserverCallback) {
          scrolledToEnd = () =>
            seen([{ isIntersecting: true }] as IntersectionObserverEntry[], this as never);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const next = { start: null, path: null, skip: 1 };
    serveHistory((url) =>
      url.searchParams.has("skip") ? json(page([commit(2)])) : json(page([commit(3)], next)),
    );
    renderWithQueries(<Picker rows={[]} tabs={["commits"]} />);
    await openPicker();
    await waitFor(() => expect(options()).toEqual(["ccccccc Commit 3", "… more commits"]));
    await userEvent.click(screen.getByRole("option", { name: "… more commits" }));
    expect(selectedTab()).toBe("Commits 1+");
    // A new list: not focusing the commit where the row clicked was.
    expect(document.querySelector("[role=option][data-focused]")).toBeNull();
    act(() => scrolledToEnd());
    await waitFor(() => expect(options()).toEqual(["ccccccc Commit 3", "ccccccc Commit 2"]));
    expect(within(screen.getByRole("tab", { selected: true })).getByText("2")).toBeInTheDocument();
  });
});

describe("what the picker shows", () => {
  const known = page([]);

  it("names a Revision as git shortens it", () => {
    expect(pickedText("HEAD", known)).toBe("HEAD (main)");
    expect(pickedText("working-tree", known)).toBe("Working tree");
    expect(pickedText("refs/remotes/origin/main", known)).toBe("origin/main");
    expect(pickedText("c".repeat(40), known)).toBe("ccccccc");
  });

  it("opens on the tab that lists it", () => {
    const all: PickerTab[] = ["branches", "tags", "commits"];
    expect(tabOf("refs/tags/v1", known, all)).toBe("tags");
    expect(tabOf("origin/main", known, all)).toBe("branches");
    expect(tabOf("abc1234", known, all)).toBe("commits");
    expect(tabOf("abc1234", known, ["branches"])).toBeUndefined();
    expect(tabOf("HEAD", known, all)).toBeUndefined();
  });

  it("ranks names: the same, starting with it, at a word's start, within, apart", () => {
    const ranks = ["main", "main-fix", "fix/main", "domain", "main/old fix"].map((name) =>
      matchRank(name, "MAIN"),
    );
    expect(ranks).toEqual([0, 1, 2, 3, 1]);
    expect(matchRank("fix/old-main", "main fix")).toBe(4);
    expect(matchRank("feature", "main")).toBeUndefined();
    expect(matchRank("feature", " ")).toBe(0);
  });
});
