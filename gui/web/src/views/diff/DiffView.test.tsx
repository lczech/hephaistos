import { QueryClientProvider } from "@tanstack/react-query";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Schemas } from "../../api/client";
import type { DiffLook, Versions } from "../../components/diff/Diff";
import { json, renderWithQueries, serve, setting } from "../../test/server";
import { type Address, addressText, type Params } from "../address";
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
  diff: Schemas["DiffJson"],
  {
    theme = "github-dark",
    changes = [] as Schemas["ChangeGroupJson"][],
    commit = null as Schemas["ShownCommitJson"] | null,
  } = {},
): Request[] {
  return serve({
    "GET /api/diff": () => json(diff),
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
function Diff({ initial }: { initial: Params }) {
  const [params, setParams] = useState<Params>(initial);
  const [title, setTitle] = useState("");
  return (
    <>
      <output>{addressText({ kind: "diff", params })}</output>
      <h1>{title}</h1>
      <DiffView params={params} setParams={setParams} setTitle={setTitle} />
    </>
  );
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
    await userEvent.click(screen.getByRole("button", { name: "Compare with other Revisions" }));
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
    await userEvent.click(screen.getByRole("button", { name: "Commit history of this Checkout" }));
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
      // A click on a header collapses its file, its chevron saying so; another shows it again.
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
        <DiffView params={params} setParams={() => {}} setTitle={() => {}} />
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
      // A file collapsed, then its directory's parent: all below it gone, but its header.
      await userEvent.click(within(region("src/app/main.py")).getByText("main.py"));
      const folder = screen.getByRole("button", { name: "Files in src/" });
      await userEvent.click(folder);
      expect(folder).toHaveAttribute("aria-expanded", "false");
      expect(shown()).toEqual(["src/", "top.txt"]);
      // Shown again, the file stays collapsed as it was.
      await userEvent.click(within(region("src/")).getByText("2 files"));
      expect(shown()).toEqual(["src/", "src/app/", "src/app/main.py", "src/a.py", "top.txt"]);
      expect(screen.getByRole("button", { name: "Diff of src/app/main.py" })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      // All at once: one file collapsed is neither all nor none; a click collapses all files,
      // directories shown; another shows all again.
      const all = screen.getByRole("button", { name: "All files collapsed" });
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
      await userEvent.click(screen.getByRole("button", { name: "Directories as a tree" })); // as it was
    });

    it("asks for a file's diff only as it comes near", async () => {
      const asked = serveAll();
      renderWithQueries(<Diff initial={SINCE_HEAD} />);
      expect(await screen.findByRole("region", { name: "src/b.py" })).toBeInTheDocument();
      expect(screen.queryByRole("figure")).toBeNull();
      expect(asked.diffs).toEqual([]);
    });
  });
});
