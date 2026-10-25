import { QueryClientProvider } from "@tanstack/react-query";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Schemas } from "../../api/client";
import type { DiffLook, Versions } from "../../components/diff/Diff";
import { json, renderWithQueries, serve, setting } from "../../test/server";
import { InPanel } from "../../test/view";
import type { Address, Params } from "../address";
import { OpenViewContext } from "../opening";
import { DiffView } from "./DiffView";

// The renderer draws in a way jsdom can't show; this stand-in shows what it was given.
vi.mock("../../components/diff/LazyDiff", () => ({
  LazyDiff: ({
    patch,
    look,
    versions,
  }: {
    patch: string;
    look: DiffLook;
    versions: Versions | undefined;
  }) => (
    <figure>
      <pre>{patch}</pre>
      <figcaption>{JSON.stringify(look)}</figcaption>
      <p>{versions ? `versions: ${JSON.stringify(versions)}` : "no versions"}</p>
    </figure>
  ),
  LazyDiffScroll: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

type Change = Schemas["ChangeJson"];

function change(fields: Partial<Change> = {}): Change {
  return {
    path: "src/main.py",
    status: "M",
    original: null,
    added: 1,
    removed: 1,
    binary: false,
    size: null,
    old_size: null,
    files: null,
    more_files: false,
    ...fields,
  };
}

const PATCH = "diff --git a/src/main.py b/src/main.py\n@@ -1 +1 @@\n-a\n+b\n";

/** The Server, answering for the diff and the settings; returns the requests asked. */
function serveDiff(
  diff: Schemas["DiffJson"] | (() => Response), // the answer, or how to give it
  {
    theme = "github-dark",
    changes = [] as Schemas["ChangeGroupJson"][],
    commit = null as Schemas["ShownCommitJson"] | null,
  } = {},
): Request[] {
  return serve({
    "GET /api/diff": () => (typeof diff === "function" ? diff() : json(diff)),
    "GET /api/diff/files": () => json({ old: "a\n", new: "b\n" }),
    "GET /api/changes": () => json({ branch: null, groups: changes, commit }),
    "GET /api/config": () =>
      json({
        host: "laptop",
        settings: [
          setting("gui.code.theme_light", "github-light"),
          setting("gui.code.theme_dark", theme),
          setting("gui.diff.large_lines", 10),
          setting("gui.diff.context", 5),
        ],
        sources: [],
        other_hosts: [],
        unknown_variables: [],
      }),
  });
}

const STAGED = { clone: "clone-proj", from: "HEAD", to: "index", path: "src/main.py" };

/** The View as a Panel holds it: with its parameters, shown as its address, and its title. */
function Diff({ initial, fragment }: { initial: Params; fragment?: Params }) {
  return <InPanel view={DiffView} kind="diff" params={initial} fragment={fragment} />;
}

afterEach(() => localStorage.clear());

describe("the Diff View", () => {
  it("shows a file's diff in a commit, its line in the bar, leading to other Revisions", async () => {
    const hash = "c".repeat(40);
    const parent = "b".repeat(40);
    const person = { name: "Lucas", email: "lucas@example.org", at: new Date().toISOString() };
    const shown = {
      name: hash,
      commit: {
        hash,
        parents: [parent],
        subject: "Fix the parser",
        body: "",
        author: person,
        committer: person,
        refs: [],
        renamed_from: null,
      },
      reachable: true,
      amended_as: null,
    };
    const requests = serveDiff({ change: change(), patch: PATCH }, { commit: shown });
    renderWithQueries(
      <Diff initial={{ clone: "clone-proj", commit: hash, path: "src/main.py" }} />,
    );
    expect(await screen.findByText(/^diff --git/)).toBeInTheDocument();
    const asked = requests.map((request) => new URL(request.url));
    expect(asked.find((url) => url.pathname === "/api/diff")?.search).toBe(
      `?clone=clone-proj&commit=${hash}&path=src%2Fmain.py&context=5`,
    );
    expect(screen.getByRole("heading")).toHaveTextContent("Diff: main.py, ccccccc");
    const line = await screen.findByRole("button", { name: /Fix the parser/ });
    expect(line).toHaveTextContent("ccccccc");
    await userEvent.click(line);
    expect(screen.getByText("Lucas <lucas@example.org>")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Compare with other revisions" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      `diff?clone=clone-proj&from=${parent}&path=src%2Fmain.py&to=${hash}`,
    );
    expect(screen.getByRole("button", { name: "Compare from: bbbbbbb" })).toBeInTheDocument();
  });

  it("shows git's patch, as chosen to look, for all Diffs", async () => {
    const requests = serveDiff({ change: change(), patch: PATCH });
    renderWithQueries(<Diff initial={STAGED} />);
    expect(await screen.findByText(/^diff --git/)).toHaveTextContent("+b");
    expect(screen.getByRole("heading")).toHaveTextContent("Diff: main.py, staged");
    // What is compared, in the bar, not again above the diff.
    expect(screen.getByRole("button", { name: "Compare from: HEAD" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compare to: Staged (index)" })).toBeInTheDocument();
    expect(within(screen.getByRole("figure")).queryByText("staged")).toBeNull();
    expect(screen.getByText(/"split"/)).toHaveTextContent(
      '{"split":true,"wrap":false,"whole":false}',
    );
    await userEvent.click(screen.getByRole("button", { name: "Wrap" }));
    await userEvent.click(screen.getByRole("button", { name: "Side by side" }));
    expect(screen.getByText(/"split"/)).toHaveTextContent(
      '{"split":false,"wrap":true,"whole":false}',
    );
    expect(JSON.parse(localStorage.getItem("hephaistos.diff") ?? "")).toEqual({
      split: false,
      wrap: true,
      whole: false,
    });
    // Both versions, after the patch: where the file ends, and all of it.
    expect(await screen.findByText(/^versions:/)).toHaveTextContent(
      'versions: {"old":"a\\n","new":"b\\n"}',
    );
    const asked = requests.map((request) => new URL(request.url));
    expect(asked.map((url) => url.pathname).filter((path) => path.startsWith("/api/diff"))).toEqual(
      ["/api/diff", "/api/diff/files"],
    );
    expect(asked.find((url) => url.pathname === "/api/diff")?.search).toBe(
      "?clone=clone-proj&from=HEAD&to=index&path=src%2Fmain.py&context=5",
    );
    expect(asked.find((url) => url.pathname === "/api/diff/files")?.search).toBe(
      "?clone=clone-proj&from=HEAD&to=index&path=src%2Fmain.py",
    );
  });

  it("shows old and new inline in a narrow Panel, as it was while its tab is hidden", async () => {
    // Widths reported to the View as a whole, as a browser measures it.
    const observed: [ResizeObserverCallback, Element][] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private report: ResizeObserverCallback) {}
        observe(target: Element) {
          observed.push([this.report, target]);
        }
        unobserve() {}
        disconnect() {}
      },
    );
    const resize = (width: number) =>
      act(() => {
        for (const [report, target] of observed) {
          if (!target.querySelector("[aria-label='Side by side']")) continue;
          report([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver);
        }
      });
    serveDiff({ change: change(), patch: PATCH });
    renderWithQueries(<Diff initial={STAGED} />);
    const split = await screen.findByRole("button", { name: "Side by side" });
    expect(split).toHaveAttribute("aria-pressed", "true");
    resize(500);
    expect(split).toHaveAttribute("aria-pressed", "false");
    resize(1000);
    resize(0); // hidden, e.g. in another tab: not narrow, nor drawn anew
    expect(split).toHaveAttribute("aria-pressed", "true");
  });

  it("shows a diff first with its versions, so that it doesn't grow once they come", async () => {
    let answer: ((response: Response) => void) | undefined;
    serve({
      "GET /api/diff": () => json({ change: change(), patch: PATCH }),
      "GET /api/diff/files": () => new Promise((resolve) => (answer = resolve)),
      "GET /api/config": () =>
        json({ host: "laptop", settings: [], sources: [], other_hosts: [], unknown_variables: [] }),
    });
    renderWithQueries(<Diff initial={STAGED} />);
    expect(await screen.findByText("src/main.py", { exact: false })).toBeInTheDocument();
    await waitFor(() => expect(answer).toBeDefined());
    expect(screen.queryByRole("figure")).toBeNull();
    expect(screen.getByText("Loading the diff…")).toBeInTheDocument();
    answer?.(json({ old: "a\n", new: "b\n" }));
    expect(await screen.findByText(/^versions:/)).toBeInTheDocument();
  });

  it("asks no versions of an added file, all of which its patch has", async () => {
    const requests = serveDiff({ change: change({ status: "A" }), patch: PATCH });
    renderWithQueries(<Diff initial={STAGED} />);
    expect(await screen.findByText("no versions")).toBeInTheDocument();
    expect(requests.map((request) => new URL(request.url).pathname)).not.toContain(
      "/api/diff/files",
    );
  });

  it("waits to show a large diff", async () => {
    serveDiff({ change: change({ added: 8, removed: 4 }), patch: PATCH });
    renderWithQueries(<Diff initial={STAGED} />);
    expect(await screen.findByText(/12 lines changed/)).toBeInTheDocument();
    expect(screen.queryByRole("figure")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getByRole("figure")).toBeInTheDocument();
  });

  it("says why it shows no patch", async () => {
    const binary = change({ added: null, removed: null, binary: true, size: 2000, old_size: 1000 });
    serveDiff({ change: binary, patch: null });
    const { unmount } = renderWithQueries(<Diff initial={STAGED} />);
    expect(await screen.findByText("Not shown: binary, 1.0 kB → 2.0 kB.")).toBeInTheDocument();
    unmount();
    serveDiff({ change: change({ added: 3 }), patch: null });
    renderWithQueries(<Diff initial={STAGED} />);
    expect(await screen.findByText(/more than the setting/)).toHaveTextContent(
      "Not shown, more than the setting gui.diff.max_bytes allows.",
    );
  });

  it("offers where an unchanged file's changes are now", async () => {
    const groups: Schemas["ChangeGroupJson"][] = [
      { name: "staged", from: "HEAD", to: "index", changes: [change()], count: 1 },
    ];
    serveDiff({ change: null, patch: null }, { changes: groups });
    renderWithQueries(<Diff initial={{ ...STAGED, from: "index", to: "working-tree" }} />);
    expect(await screen.findByText(/The changes are now in/)).toHaveTextContent(
      /^No unstaged changes\. The changes are now in:/,
    );
    const offered = screen.getAllByRole("button").map((button) => button.textContent);
    expect(offered.slice(-2)).toEqual(["Staged", "Since HEAD"]);
    await userEvent.click(screen.getByRole("button", { name: "Staged" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "diff?clone=clone-proj&from=HEAD&path=src%2Fmain.py&to=index",
    );
  });

  it("says when nothing is left to show", async () => {
    serveDiff({ change: null, patch: null });
    renderWithQueries(<Diff initial={STAGED} />);
    expect(await screen.findByText(/Nothing left/)).toHaveTextContent(
      "No staged changes. Nothing left: committed or undone.",
    );
  });

  it("says a file's Checkout is gone, in place of its diff, with the Events of its Clone", async () => {
    const checkout = { clone: "clone-proj", worktree: "wt-side", gone: "clone" } as const;
    const error = "the clone of the worktree at ~/side was unregistered; its files are untouched";
    serveDiff(() => json({ error, checkout }, 410));
    const opened: Address[] = [];
    renderWithQueries(
      <OpenViewContext.Provider value={(address) => opened.push(address)}>
        <Diff initial={{ worktree: "wt-side", from: "HEAD", to: "index", path: "src/main.py" }} />
      </OpenViewContext.Provider>,
    );
    expect(await screen.findByText(/^The clone of the worktree at ~\/side/)).toHaveTextContent(
      `T${error.slice(1)}.`,
    );
    expect(screen.queryByRole("button", { name: "Side by side" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "The clone's events" }));
    expect(opened).toEqual([{ kind: "events", params: { clone: "clone-proj" } }]);
  });

  it("names a code theme it doesn't know", async () => {
    serveDiff({ change: change(), patch: PATCH }, { theme: "no-such-theme" });
    renderWithQueries(<Diff initial={STAGED} />);
    expect(await screen.findByText(/Unknown code theme no-such-theme/)).toBeInTheDocument();
  });

  it("leads from one file to all files compared so, and back to the list", async () => {
    serveDiff({ change: change(), patch: PATCH }, { changes: [] });
    const opened: Address[] = [];
    const { client, rerender } = renderWithQueries(
      <OpenViewContext.Provider value={(address) => opened.push(address)}>
        <Diff initial={STAGED} />
      </OpenViewContext.Provider>,
    );
    const { path, ...staged } = STAGED;
    // How directories show matters to all files' order only.
    expect(screen.queryByRole("button", { name: "Directories as a tree" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "All changed files as one Diff" }));
    await userEvent.click(screen.getByRole("button", { name: `Commit history of ${path}` }));
    // All files: the list of them, and the Checkout's history.
    rerender(
      <QueryClientProvider client={client}>
        <OpenViewContext.Provider value={(address) => opened.push(address)}>
          <Diff key="all" initial={staged} />
        </OpenViewContext.Provider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("button", { name: "Directories as a tree" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "These changes as a list" }));
    await userEvent.click(screen.getByRole("button", { name: "Commit history of this checkout" }));
    expect(opened).toEqual([
      { kind: "diff", params: staged },
      { kind: "history", params: { clone: "clone-proj", path } },
      { kind: "changes", params: staged },
      { kind: "history", params: { clone: "clone-proj" } },
    ]);
  });

  it("says when nothing is compared", () => {
    serve({});
    renderWithQueries(<Diff initial={{ clone: "clone-proj" }} />);
    expect(screen.getByText(/Nothing compared/)).toBeInTheDocument();
  });

  describe("finding in a file's diff", () => {
    // A change in the middle of a seven-line file; `beta` in four of the patch's lines, two
    // more in the lines collapsed around it (two each side: one alone would show).
    const FOUND = `diff --git a/src/main.py b/src/main.py
--- a/src/main.py
+++ b/src/main.py
@@ -3,3 +3,3 @@
 beta one
-alpha beta
+alpha Beta
 betamax
`;
    const OLD = "zero beta\nfiller\nbeta one\nalpha beta\nbetamax\nfiller\nlast beta\n";

    function serveFound() {
      serve({
        "GET /api/diff": () => json({ change: change(), patch: FOUND }),
        "GET /api/diff/files": () =>
          json({ old: OLD, new: OLD.replace("alpha beta", "alpha Beta") }),
        "GET /api/config": () =>
          json({
            host: "laptop",
            settings: [],
            sources: [],
            other_hosts: [],
            unknown_variables: [],
          }),
      });
    }

    const address = () => screen.getAllByRole("status")[0]; // the Panel's, before the bar's
    // Its landmark by name: jsdom's ARIA roles don't know `<search>`.
    const bar = () => screen.getByLabelText("Find", { selector: "search" });
    const status = () => within(bar()).getByRole("status");

    it("finds in the patch's lines as typed, stepping round by Enter and Shift+Enter", async () => {
      serveFound();
      renderWithQueries(<Diff initial={STAGED} />);
      await screen.findByText(/^diff --git/);
      await userEvent.click(screen.getByRole("button", { name: "Find in this diff" }));
      const field = within(bar()).getByRole("textbox", { name: "Find in the diff" });
      expect(field).toHaveFocus();
      expect(address()).toHaveTextContent(/#find=$/);
      await userEvent.type(field, "beta");
      await waitFor(() => expect(status()).toHaveTextContent("1 of 4"));
      expect(address()).toHaveTextContent("find=beta");
      await userEvent.keyboard("{Enter}");
      expect(status()).toHaveTextContent("2 of 4");
      await userEvent.keyboard("{Shift>}{Enter}{Enter}{/Shift}");
      expect(status()).toHaveTextContent("4 of 4"); // round, to the last
      await userEvent.click(within(bar()).getByRole("button", { name: "Next match" }));
      expect(status()).toHaveTextContent("1 of 4");
    });

    it("matches case or whole words if asked, and the whole file's lines while it shows", async () => {
      serveFound();
      renderWithQueries(<Diff initial={STAGED} fragment={{ find: "beta" }} />);
      await waitFor(() => expect(status()).toHaveTextContent("1 of 4"));
      await userEvent.click(within(bar()).getByRole("button", { name: "Match case" }));
      await waitFor(() => expect(status()).toHaveTextContent("1 of 3"));
      expect(address()).toHaveTextContent("case=1");
      await userEvent.click(within(bar()).getByRole("button", { name: "Match case" }));
      await userEvent.click(within(bar()).getByRole("button", { name: "Match whole words" }));
      await waitFor(() => expect(status()).toHaveTextContent("1 of 3")); // not betamax
      await userEvent.click(screen.getByRole("button", { name: "Whole file" }));
      await waitFor(() => expect(status()).toHaveTextContent("1 of 5")); // + zero, last beta
    });

    it("counts a line alone between hunks before the diff is drawn: it shows, as the renderer's", async () => {
      // Lines 1 and 5 changed, 3 alone between their hunks.
      const patch = `diff --git a/src/main.py b/src/main.py
@@ -1,2 +1,2 @@
-a
+b
 x
@@ -4,2 +4,2 @@
 x
-c
+d
`;
      serve({
        "GET /api/diff": () => json({ change: change(), patch }),
        "GET /api/diff/files": () => json({ old: "a\nx\nbeta\nx\nc\n", new: "b\nx\nbeta\nx\nd\n" }),
        "GET /api/config": () =>
          json({
            host: "laptop",
            settings: [],
            sources: [],
            other_hosts: [],
            unknown_variables: [],
          }),
      });
      renderWithQueries(<Diff initial={STAGED} fragment={{ find: "beta" }} />);
      await waitFor(() => expect(status()).toHaveTextContent("1 of 1"));
    });

    it("says why a regular expression is invalid", async () => {
      serveFound();
      renderWithQueries(<Diff initial={STAGED} fragment={{ find: "(beta", regex: "1" }} />);
      expect(await within(bar()).findByText(/Unterminated group/)).toBeInTheDocument();
      expect(within(bar()).getByRole("button", { name: "Next match" })).toBeDisabled();
    });

    it("closes by Escape, back to its button, leaving nothing of it in the address", async () => {
      serveFound();
      renderWithQueries(<Diff initial={STAGED} fragment={{ find: "beta", word: "1" }} />);
      await userEvent.click(within(bar()).getByRole("textbox", { name: "Find in the diff" }));
      await userEvent.keyboard("{Escape}");
      expect(screen.queryByLabelText("Find", { selector: "search" })).toBeNull();
      expect(screen.getByRole("button", { name: "Find in this diff" })).toHaveFocus();
      expect(address()).not.toHaveTextContent(/find|word/);
    });
  });

  describe("of all files", () => {
    const SINCE_HEAD = { clone: "clone-proj", from: "HEAD", to: "working-tree" };
    const GROUP = {
      name: "changes" as const,
      from: "HEAD",
      to: "working-tree",
      count: 4,
      changes: [
        change({ path: "README.md", added: 2, removed: 0 }),
        change({ path: "notes.txt", status: "?", added: 4, removed: 0 }),
        change({ path: "src/b.py" }),
        change({ path: "tmp/", status: "?", added: null, removed: null, files: 1, size: 9 }),
      ],
    };

    /**
     * The Server, answering each file's diff with its patch, its list cut short of `count`;
     * returns the paths asked.
     */
    function serveAll(count = GROUP.count): { diffs: string[]; within: string[] } {
      const asked = { diffs: [] as string[], within: [] as string[] };
      serve({
        "GET /api/changes": (request) => {
          const path = new URL(request.url).searchParams.get("path");
          if (path === null)
            return json({ branch: null, groups: [{ ...GROUP, count }], commit: null });
          asked.within.push(path);
          const files = [change({ path: "tmp/a.log", status: "?", added: 3, removed: 0 })];
          return json({ branch: null, groups: [{ ...GROUP, changes: files, count: 1 }] });
        },
        "GET /api/diff": (request) => {
          const path = new URL(request.url).searchParams.get("path") ?? "";
          asked.diffs.push(path);
          return json({ change: change({ path }), patch: `diff --git a/${path} b/${path}\n` });
        },
        "GET /api/config": () =>
          json({
            host: "laptop",
            settings: [],
            sources: [],
            other_hosts: [],
            unknown_variables: [],
          }),
      });
      return asked;
    }

    /** Everything comes near as soon as it is there. */
    class Near {
      constructor(private report: IntersectionObserverCallback) {}
      observe(target: Element) {
        const entry = { isIntersecting: true, target } as IntersectionObserverEntry;
        this.report([entry], this as unknown as IntersectionObserver);
      }
      unobserve() {}
      disconnect() {}
    }

    it("shows them one under the other as Changes lists them, untracked ones listed", async () => {
      vi.stubGlobal("IntersectionObserver", Near);
      const asked = serveAll();
      renderWithQueries(<Diff initial={SINCE_HEAD} />);
      expect(await screen.findByText("Total: 3 files")).toBeInTheDocument(); // above all
      const files = await screen.findAllByRole("region", { name: /^(src|README)/ });
      // A directory holds its files, under its header.
      expect(files.map((file) => file.getAttribute("aria-label"))).toEqual([
        "src/",
        "src/b.py",
        "README.md",
      ]);
      expect(files[0]).toContainElement(files[1] as HTMLElement);
      expect(files[0]).toHaveTextContent("1 file");
      await waitFor(() => expect(screen.getAllByRole("figure")).toHaveLength(2));
      expect(asked.diffs.sort()).toEqual(["README.md", "src/b.py"]);
      const first = files[1] as HTMLElement;
      expect(
        within(first).getByRole("button", { name: "Diff of src/b.py alone" }),
      ).toBeInTheDocument();
      // A click on a header folds its file, its chevron saying so; another unfolds it.
      await userEvent.click(within(first).getByText("b.py"));
      expect(within(first).queryByRole("figure")).toBeNull();
      const chevron = within(first).getByRole("button", { name: "Diff of src/b.py" });
      expect(chevron).toHaveAttribute("aria-expanded", "false");
      await userEvent.click(chevron);
      expect(within(first).getByRole("figure")).toBeInTheDocument();
      // Untracked: listed, each diff asked for once opened, or all at once.
      const untracked = screen.getByRole("region", { name: "Untracked" });
      expect(untracked).toHaveTextContent("Untracked: 1 file, 1 new folder");
      await userEvent.click(within(untracked).getByText("notes.txt"));
      expect(await within(untracked).findByRole("figure")).toBeInTheDocument();
      expect(asked.diffs).toContain("notes.txt");
      await userEvent.click(within(untracked).getByRole("button", { name: "Show all" }));
      await waitFor(() => expect(within(untracked).getAllByRole("figure")).toHaveLength(2));
      expect(asked.within).toEqual(["tmp/"]);
      expect(asked.diffs).toContain("tmp/a.log");
      expect(screen.getByRole("button", { name: "These changes as a list" })).toBeInTheDocument();
    });

    it("isn't dimmed once one file shows in its place", async () => {
      serveAll();
      const view = (params: Params) => (
        <DiffView
          params={params}
          setParams={() => {}}
          fragment={{}}
          setFragment={() => {}}
          endTyping={() => {}}
          setTitle={() => {}}
        />
      );
      const { container, client, rerender } = renderWithQueries(view(SINCE_HEAD));
      expect(await screen.findByRole("region", { name: "src/b.py" })).toBeInTheDocument();
      // Back to one file, as its Panel goes: the list of all files no longer asked for.
      rerender(
        <QueryClientProvider client={client}>
          {view({ ...SINCE_HEAD, path: "src/b.py" })}
        </QueryClientProvider>,
      );
      expect(await screen.findByRole("figure")).toBeInTheDocument();
      expect(container.querySelector("[data-stale]")).toBeNull();
    });

    it("says that more aren't listed, past a setting, not at their end", async () => {
      serveAll(1_004);
      renderWithQueries(<Diff initial={SINCE_HEAD} />);
      expect(await screen.findByText("Total: 3 files (1,000 more not listed)")).toBeInTheDocument();
      expect(
        screen.getByText(
          "1,000 more not listed, as the setting gui.diff.max_files allows 4 per list.",
        ),
      ).toBeInTheDocument();
    });

    it("folds a directory's files, nested its directories too, each file keeping its own", async () => {
      vi.stubGlobal("IntersectionObserver", Near);
      const changes = [
        change({ path: "src/a.py" }),
        change({ path: "src/app/main.py" }),
        change({ path: "top.txt" }),
      ];
      serve({
        "GET /api/changes": () => json({ branch: null, groups: [{ ...GROUP, changes, count: 3 }] }),
        "GET /api/diff": (request) => {
          const path = new URL(request.url).searchParams.get("path") ?? "";
          return json({ change: change({ path }), patch: `diff --git a/${path} b/${path}\n` });
        },
      });
      renderWithQueries(<Diff initial={SINCE_HEAD} />);
      const region = (name: string) => screen.getByRole("region", { name });
      await screen.findByRole("region", { name: "src/" });
      const shown = () =>
        screen.queryAllByRole("region").map((section) => section.getAttribute("aria-label"));
      // Flat: each directory by its path, apart; top.txt at the top level, last.
      expect(shown()).toEqual(["src/", "src/a.py", "src/app/", "src/app/main.py", "top.txt"]);
      await userEvent.click(screen.getByRole("button", { name: "Directories as a tree" }));
      expect(shown()).toEqual(["src/", "src/app/", "src/app/main.py", "src/a.py", "top.txt"]);
      // A file folded, then its directory's parent: all below it gone, but its header.
      await userEvent.click(within(region("src/app/main.py")).getByText("main.py"));
      const folder = screen.getByRole("button", { name: "Files in src/" });
      await userEvent.click(folder);
      expect(folder).toHaveAttribute("aria-expanded", "false");
      expect(shown()).toEqual(["src/", "top.txt"]);
      // Unfolded, the file stays folded as it was.
      await userEvent.click(within(region("src/")).getByText("2 files"));
      expect(shown()).toEqual(["src/", "src/app/", "src/app/main.py", "src/a.py", "top.txt"]);
      expect(screen.getByRole("button", { name: "Diff of src/app/main.py" })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      // All at once: one file folded is neither all nor none; a click folds all files,
      // directories shown; another shows all again.
      const all = screen.getByRole("button", { name: "All files folded" });
      expect(all).toHaveAttribute("aria-pressed", "mixed");
      await userEvent.click(all);
      expect(all).toHaveAttribute("aria-pressed", "true");
      const expanded = () =>
        screen
          .getAllByRole("button", { name: /^(Diff of|Files in) / })
          .filter((button) => button.hasAttribute("aria-expanded")) // not the links
          .map((button) => [
            button.getAttribute("aria-label"),
            button.getAttribute("aria-expanded"),
          ]);
      expect(expanded()).toEqual([
        ["Files in src/", "true"],
        ["Files in src/app/", "true"],
        ["Diff of src/app/main.py", "false"],
        ["Diff of src/a.py", "false"],
        ["Diff of top.txt", "false"],
      ]);
      await userEvent.click(all);
      expect(all).toHaveAttribute("aria-pressed", "false");
      expect(expanded().every(([, open]) => open === "true")).toBe(true);
    });

    it("keeps folds per Checkout, in every comparison, a directory's for all below it", async () => {
      vi.stubGlobal("IntersectionObserver", Near);
      const changes = [
        change({ path: "src/a.py" }),
        change({ path: "src/app/main.py" }),
        change({ path: "top.txt" }),
      ];
      serve({
        "GET /api/changes": () => json({ branch: null, groups: [{ ...GROUP, changes, count: 3 }] }),
        "GET /api/diff": (request) => {
          const path = new URL(request.url).searchParams.get("path") ?? "";
          return json({ change: change({ path }), patch: `diff --git a/${path} b/${path}\n` });
        },
      });
      const first = renderWithQueries(<Diff initial={SINCE_HEAD} />);
      await userEvent.click(await screen.findByRole("button", { name: "Files in src/" }));
      await userEvent.click(screen.getByRole("button", { name: "Diff of top.txt" }));
      first.unmount();
      // Another comparison: folded as before; each directory by its path, src/app/ with src/.
      const staged = { clone: "clone-proj", from: "HEAD", to: "index" };
      const second = renderWithQueries(<Diff initial={staged} />);
      const chevron = (name: string) => screen.getByRole("button", { name });
      await screen.findByRole("region", { name: "src/app/" });
      expect(chevron("Files in src/")).toHaveAttribute("aria-expanded", "false");
      expect(chevron("Diff of top.txt")).toHaveAttribute("aria-expanded", "false");
      const app = screen.getByRole("region", { name: "src/app/" });
      expect(app).toHaveTextContent("folded with src/");
      expect(within(app).getByRole("button", { name: "Files in src/app/" })).toHaveAttribute(
        "title",
        "Unfold src/ and all in it",
      );
      // Shown, src/app/ shows src/ too; all files shown at once, top.txt too.
      await userEvent.click(within(app).getByText("1 file"));
      expect(chevron("Files in src/")).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("region", { name: "src/app/main.py" })).toBeInTheDocument();
      await userEvent.click(chevron("Files in src/"));
      // Every file folded, by its own or its directory's: all folded, until all are unfolded.
      const all = screen.getByRole("button", { name: "All files folded" });
      expect(all).toHaveAttribute("aria-pressed", "true");
      await userEvent.click(all);
      expect(all).toHaveAttribute("aria-pressed", "false");
      expect(chevron("Files in src/")).toHaveAttribute("aria-expanded", "true");
      expect(chevron("Diff of top.txt")).toHaveAttribute("aria-expanded", "true");
      await userEvent.click(chevron("Diff of top.txt"));
      second.unmount();
      // Another Checkout's are its own; Changes', apart.
      renderWithQueries(<Diff initial={{ ...SINCE_HEAD, clone: "clone-other" }} />);
      expect(await screen.findByRole("button", { name: "Diff of top.txt" })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      expect(JSON.parse(localStorage.getItem("hephaistos.folds.diff") ?? "")).toEqual({
        "clone:clone-proj": { paths: { stack: ["top.txt"] }, groups: [], opened: [] },
      });
      expect(localStorage.getItem("hephaistos.folds.changes")).toBeNull();
    });

    it("folds a directory in the stack apart from the same in the untracked files", async () => {
      vi.stubGlobal("IntersectionObserver", Near);
      const changes = [change({ path: "src/a.py" }), change({ path: "src/new.txt", status: "?" })];
      serve({
        "GET /api/changes": () => json({ branch: null, groups: [{ ...GROUP, changes, count: 2 }] }),
        "GET /api/diff": (request) => {
          const path = new URL(request.url).searchParams.get("path") ?? "";
          return json({ change: change({ path }), patch: `diff --git a/${path} b/${path}\n` });
        },
      });
      renderWithQueries(<Diff initial={SINCE_HEAD} />);
      const stacked = await screen.findByRole("button", { name: "Files in src/" });
      const untracked = screen.getByRole("region", { name: "Untracked" });
      const srcRow = () => within(untracked).getAllByTitle("src/")[0] as HTMLElement;
      // Folding the untracked files' src/ leaves the stack's open, and the other way round.
      await userEvent.click(srcRow());
      expect(within(untracked).queryByText("new.txt")).toBeNull();
      expect(stacked).toHaveAttribute("aria-expanded", "true");
      await userEvent.click(stacked);
      await userEvent.click(srcRow());
      expect(within(untracked).getByText("new.txt")).toBeInTheDocument();
      expect(stacked).toHaveAttribute("aria-expanded", "false");
      expect(JSON.parse(localStorage.getItem("hephaistos.folds.diff") ?? "")).toEqual({
        "clone:clone-proj": { paths: { stack: ["src/"] }, groups: [], opened: [] },
      });
    });

    it("asks for a file's diff only as it comes near", async () => {
      const asked = serveAll();
      renderWithQueries(<Diff initial={SINCE_HEAD} />);
      expect(await screen.findByRole("region", { name: "src/b.py" })).toBeInTheDocument();
      expect(screen.queryByRole("figure")).toBeNull();
      expect(asked.diffs).toEqual([]);
    });

    describe("finding in them", () => {
      const PATCHES: Record<string, string> = {
        "README.md": "diff --git a/README.md b/README.md\n@@ -0,0 +1 @@\n+found here\n",
        "src/b.py": "diff --git a/src/b.py b/src/b.py\n@@ -1 +1 @@\n-x\n+found\n",
        "notes.txt": "diff --git a/notes.txt b/notes.txt\n@@ -0,0 +1,2 @@\n+found\n+found\n",
      };

      /** The Server, with the diffs of all tracked files a page each; returns the pages asked. */
      function serveFinding(large?: number): string[] {
        const pages: string[] = [];
        const tracked = ["README.md", "src/b.py"];
        const diffOf = (path: string) => ({ change: change({ path }), patch: PATCHES[path] });
        serve({
          "GET /api/changes": () =>
            json({ branch: null, groups: [{ ...GROUP, count: 4 }], commit: null }),
          "GET /api/diff": (request) =>
            json(diffOf(new URL(request.url).searchParams.get("path") ?? "")),
          "GET /api/diffs": (request) => {
            const skip = Number(new URL(request.url).searchParams.get("skip"));
            pages.push(String(skip));
            const path = tracked[skip] ?? "";
            const next = skip + 1 < tracked.length ? skip + 1 : null;
            return json({ diffs: [diffOf(path)], new: { [path]: null }, next });
          },
          "GET /api/config": () =>
            json({
              host: "laptop",
              settings: large === undefined ? [] : [setting("gui.diff.large_lines", large)],
              sources: [],
              other_hosts: [],
              unknown_variables: [],
            }),
        });
        return pages;
      }

      const bar = () => screen.getByLabelText("Find", { selector: "search" });
      const status = () => within(bar()).getByRole("status");

      it("finds in all files in the stack's order, untracked ones once open", async () => {
        vi.stubGlobal("IntersectionObserver", Near);
        const pages = serveFinding();
        renderWithQueries(<Diff initial={SINCE_HEAD} fragment={{ find: "found" }} />);
        await waitFor(() => expect(status()).toHaveTextContent("1 of 2"));
        expect(pages).toEqual(["0", "1"]); // all of them, page by page
        const untracked = screen.getByRole("region", { name: "Untracked" });
        await userEvent.click(within(untracked).getByText("notes.txt"));
        await waitFor(() => expect(status()).toHaveTextContent("1 of 4"));
        await userEvent.click(within(untracked).getByText("notes.txt"));
        await waitFor(() => expect(status()).toHaveTextContent("1 of 2"));
      });

      it("unfolds an untracked file's directory a match is stepped to, in its list only", async () => {
        vi.stubGlobal("IntersectionObserver", Near);
        const changes = [
          change({ path: "src/b.py" }),
          change({ path: "src/notes.txt", status: "?" }),
        ];
        const diffOf = (path: string) => ({
          change: change({ path }),
          patch: `diff --git a/${path} b/${path}\n@@ -0,0 +1 @@\n+${path === "src/b.py" ? "other" : "found"}\n`,
        });
        serve({
          "GET /api/changes": () =>
            json({ branch: null, groups: [{ ...GROUP, changes, count: 2 }], commit: null }),
          "GET /api/diff": (request) =>
            json(diffOf(new URL(request.url).searchParams.get("path") ?? "")),
          "GET /api/diffs": () =>
            json({ diffs: [diffOf("src/b.py")], new: { "src/b.py": null }, next: null }),
        });
        renderWithQueries(<Diff initial={SINCE_HEAD} />);
        const stacked = await screen.findByRole("button", { name: "Files in src/" });
        const untracked = screen.getByRole("region", { name: "Untracked" });
        await userEvent.click(within(untracked).getByText("notes.txt")); // open, to find in
        await userEvent.click(within(untracked).getAllByTitle("src/")[0] as HTMLElement);
        await userEvent.click(stacked);
        expect(within(untracked).queryByText("notes.txt")).toBeNull();
        await userEvent.click(screen.getByRole("button", { name: "Find in this diff" }));
        await userEvent.type(within(bar()).getByRole("textbox"), "found");
        await waitFor(() => expect(status()).toHaveTextContent("1 of 1"));
        await userEvent.keyboard("{Enter}");
        expect(within(untracked).getByText("notes.txt")).toBeInTheDocument();
        expect(stacked).toHaveAttribute("aria-expanded", "false");
      });

      it("unfolds a folded file a match is stepped to, and shows a large diff", async () => {
        vi.stubGlobal("IntersectionObserver", Near);
        serveFinding(1);
        renderWithQueries(<Diff initial={SINCE_HEAD} />);
        const readme = await screen.findByRole("region", { name: "README.md" });
        await userEvent.click(within(readme).getByText("README.md"));
        expect(readme).toHaveAttribute("data-folded");
        await userEvent.click(screen.getByRole("button", { name: "Find in this diff" }));
        await userEvent.type(within(bar()).getByRole("textbox"), "found");
        // Nested, src/ first: its file's match, then README's; typed, nothing shows yet.
        await waitFor(() => expect(status()).toHaveTextContent("1 of 2"));
        const file = screen.getByRole("region", { name: "src/b.py" });
        expect(within(file).getByText(/more than the setting/)).toBeInTheDocument(); // large
        expect(readme).toHaveAttribute("data-folded");
        // Stepped to: unfolded, and its large diff shown.
        await userEvent.keyboard("{Enter}");
        expect(status()).toHaveTextContent("2 of 2");
        expect(readme).not.toHaveAttribute("data-folded");
        expect(await within(readme).findByRole("figure")).toBeInTheDocument();
        await userEvent.keyboard("{Enter}");
        expect(await within(file).findByRole("figure")).toBeInTheDocument();
        // Unfolded for good: as it was once the row closes.
        await userEvent.keyboard("{Escape}");
        expect(readme).not.toHaveAttribute("data-folded");
      });
    });
  });
});
