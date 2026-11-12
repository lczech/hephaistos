import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Schemas } from "../../api/client";
import {
  clone,
  info,
  json,
  renderWithQueries,
  repository,
  serve,
  worktree,
} from "../../test/server";
import { expectSettled, InPanel } from "../../test/view";
import type { Params } from "../address";
import type { Commit } from "../commits/rows";
import { HistoryView } from "../history/HistoryView";
import { OpenViewContext } from "../opening";
import { GraphView } from "./GraphView";

type Head = Schemas["GraphHeadJson"];

const AT = new Date(Date.now() - 2 * 3600_000).toISOString();
const hash = (name: string) => name.padEnd(40, "0");

function commit(name: string, parents: string[], fields: Partial<Commit> = {}): Commit {
  const person = { name: "Lucas", email: "lucas@example.org", at: AT };
  return {
    hash: hash(name),
    parents: parents.map(hash),
    subject: `Commit ${name}`,
    body: "",
    author: person,
    committer: person,
    refs: [],
    renamed_from: null,
    ...fields,
  };
}

const branch = (name: string, at: string) => ({
  name,
  full: `refs/heads/${name}`,
  kind: "branch" as const,
  commit: hash(at),
});

/** A feature branch, newest, off main; the main working tree on main, a Worktree on feature. */
const COMMITS = [
  commit("f", ["b"], { refs: [branch("feature", "f")] }),
  commit("m", ["b"], { refs: [branch("main", "m")] }),
  commit("b", []),
];

const MAIN: Head = {
  path: "/home/me/proj",
  commit: hash("m"),
  branch: "main",
  main: true,
  clone: "clone-proj",
  worktree: null,
  ahead: null,
  behind: null,
  against: null,
};

const FEATURE: Head = {
  path: "/home/me/proj/.worktrees/feature",
  commit: hash("f"),
  branch: "feature",
  main: false,
  clone: "clone-proj",
  worktree: "wt-proj-feature",
  ahead: 1,
  behind: 1,
  against: "main",
};

/** A Worktree, detached at a commit, by its name. */
const elsewhere = (name: string, at: string): Head => ({
  ...FEATURE,
  path: `/home/me/proj/.worktrees/${name}`,
  branch: null,
  commit: hash(at),
  worktree: `wt-proj-${name}`,
});

const GRAPH: Schemas["GraphJson"] = {
  default_branch: "main",
  branches: [
    { name: "feature", commit: hash("f"), ahead: 1, behind: 1, against: "main" },
    { name: "main", commit: hash("m"), ahead: null, behind: null, against: null },
  ],
  heads: [MAIN, FEATURE],
};

interface Served {
  graph?: Schemas["GraphJson"];
  pages?: Commit[][]; // the pages of commits, in order
  clone?: Partial<Schemas["CloneJson"]>;
  worktrees?: string[];
  hold?: Promise<void>; // pages after the first wait for it
}

function serveGraph({
  graph = GRAPH,
  pages = [COMMITS],
  clone: fields = {},
  worktrees = ["feature"],
  hold,
}: Served = {}): Request[] {
  return serve({
    "GET /api/info": () => json(info()),
    "GET /api/repositories": () =>
      json([
        repository("proj", [
          clone("proj", { worktrees: worktrees.map((name) => worktree("proj", name)), ...fields }),
        ]),
      ]),
    "GET /api/history": async (request) => {
      const skip = Number(new URL(request.url).searchParams.get("skip") ?? 0);
      if (skip > 0 && hold) await hold;
      let at = 0;
      let before = 0;
      while (at < pages.length - 1 && before < skip) before += pages[at++]?.length ?? 0;
      const commits = pages[at] ?? [];
      return json({
        head: hash("m"),
        branch: "main",
        refs: [],
        commits,
        next:
          at === pages.length - 1 ? null : { start: null, path: null, skip: skip + commits.length },
        found: null,
      });
    },
    "GET /api/graph": () => json(graph),
  });
}

const asked = (requests: Request[], path: string) =>
  new URL(requests.filter((request) => request.url.includes(path)).at(-1)?.url ?? "http://none")
    .searchParams;

const nodes = () =>
  [...document.querySelectorAll<SVGElement>("svg[data-node]")].map((node) => ({
    kind: node.getAttribute("data-node"),
    x: node.style.getPropertyValue("--node-x"),
  }));

const chip = (name: string) => screen.getByRole("button", { name });

function Graph({ initial }: { initial: Params }) {
  return <InPanel view={GraphView} kind="graph" params={initial} />;
}

const scrolled = vi.fn();
beforeEach(() => {
  scrolled.mockClear();
  Element.prototype.scrollIntoView = scrolled; // jsdom has none
});
afterEach(() => vi.unstubAllGlobals());

describe("the Graph View", () => {
  it("walks all local branches topologically, the default branch pinned in lane 0", async () => {
    const requests = serveGraph();
    renderWithQueries(<Graph initial={{ clone: "clone-proj" }} />);
    await screen.findByText("Commit b");
    await expectSettled();
    const history = asked(requests, "/api/history");
    expect([history.get("branches"), history.get("order"), history.get("clone")]).toEqual([
      "local",
      "topo",
      "clone-proj",
    ]);
    expect(asked(requests, "/api/graph").get("clone")).toBe("clone-proj");
    expect(screen.getByRole("heading")).toHaveTextContent("Graph: proj");
    // feature, the newest, beside main's lane 0; both HEADs of Checkouts, drawn larger.
    expect(nodes()).toEqual([
      { kind: "head", x: "11px" },
      { kind: "head", x: "-1px" },
      { kind: "commit", x: "-1px" },
    ]);
  });

  it("lists by date once toggled, keeping it in the address", async () => {
    const requests = serveGraph();
    renderWithQueries(<Graph initial={{ clone: "clone-proj" }} />);
    await screen.findByText("Commit b");
    await userEvent.click(screen.getByRole("button", { name: "Topological order" }));
    expect(screen.getByRole("status")).toHaveTextContent("graph?clone=clone-proj&order=date");
    await waitFor(() => expect(asked(requests, "/api/history").get("order")).toBe("date"));
  });

  it("leaves hidden branches out of the walk, and says so in its title", async () => {
    const requests = serveGraph();
    renderWithQueries(<Graph initial={{ clone: "clone-proj", hide: ["feature", "old"] }} />);
    await screen.findByText("Commit b");
    expect(asked(requests, "/api/history").getAll("hide")).toEqual(["feature", "old"]);
    expect(screen.getByRole("heading")).toHaveTextContent("Graph: proj, 2 hidden");
  });

  it("asks again for both commits and branches on refresh", async () => {
    const requests = serveGraph();
    renderWithQueries(<Graph initial={{ clone: "clone-proj" }} />);
    await screen.findByText("Commit b");
    await expectSettled();
    const count = (path: string) => requests.filter((request) => request.url.includes(path)).length;
    const before = [count("/api/history"), count("/api/graph")];
    await userEvent.click(screen.getByRole("button", { name: /^Refresh/ }));
    await waitFor(() =>
      expect([count("/api/history"), count("/api/graph")]).toEqual(before.map((n) => n + 1)),
    );
  });

  it("says where to open it from without a clone", async () => {
    serveGraph();
    renderWithQueries(<Graph initial={{}} />);
    expect(
      await screen.findByText("No clone: open the Graph from a clone or worktree in Repositories."),
    ).toBeInTheDocument();
  });
});

describe("the Checkouts in the Graph View", () => {
  it("names where each Checkout is on its badge, and how far it stands in its chip", async () => {
    serveGraph();
    renderWithQueries(<Graph initial={{ clone: "clone-proj" }} />);
    await screen.findByText("Commit b");
    expect(screen.getByTitle("branch, checked out in worktree feature")).toHaveTextContent(
      "featurefeature",
    );
    expect(screen.getByTitle("branch, checked out in clone proj")).toHaveTextContent("mainproj");
    expect(chip("Worktree feature")).toHaveTextContent("featurefeature↑1 ↓1");
    expect(chip("Worktree feature")).toHaveAttribute(
      "title",
      "Worktree feature: feature; 1 ahead of main, 1 behind; a click goes to its HEAD",
    );
    expect(chip("Clone proj")).toHaveTextContent(/^projmain$/);
    expect(chip("Clone proj")).toHaveAttribute("aria-current", "true"); // opened at the Clone
  });

  it("says a HEAD is detached, on a badge and a chip of its own, in git's words", async () => {
    serveGraph({
      graph: { ...GRAPH, heads: [MAIN, elsewhere("loose", "b")] },
      worktrees: ["loose"],
    });
    renderWithQueries(<Graph initial={{ clone: "clone-proj" }} />);
    await screen.findByText("Commit b");
    expect(chip("Worktree loose")).toHaveTextContent(`loosedetached at ${hash("b").slice(0, 7)}`);
    expect(
      screen.getByTitle(`HEAD of worktree loose, detached at ${hash("b").slice(0, 7)}`),
    ).toHaveTextContent("detachedloose");
  });

  it("shows what is not committed in a Checkout above its HEAD", async () => {
    serveGraph({ clone: { changed: 2, untracked: 1 } });
    renderWithQueries(<Graph initial={{ clone: "clone-proj" }} />);
    const text = await screen.findByText("Uncommitted in proj: 2 changed, 1 untracked");
    const items = screen.getAllByRole("listitem");
    const at = items.findIndex((item) => item.contains(text));
    expect(items[at + 1]).toHaveTextContent("Commit m");
    expect(
      within(items[at] as HTMLElement).getByRole("button", { name: "Uncommitted changes" }),
    ).toBeInTheDocument();
    expect(nodes().map((node) => node.kind)).toEqual(["head", "uncommitted", "head", "commit"]);
  });

  it("goes to a HEAD not loaded yet, loading older pages until it shows at the top", async () => {
    const graph = { ...GRAPH, heads: [MAIN, FEATURE, elsewhere("old", "o")] };
    const requests = serveGraph({ graph, pages: [COMMITS, [commit("o", [])]], worktrees: ["old"] });
    renderWithQueries(<Graph initial={{ clone: "clone-proj" }} />);
    await screen.findByText("Commit b");
    expect(screen.queryByText("Commit o")).toBeNull();
    await userEvent.click(chip("Worktree old"));
    await screen.findByText("Commit o");
    await waitFor(() => expect(scrolled).toHaveBeenCalledTimes(1));
    expect(scrolled).toHaveBeenCalledWith({ block: "start" });
    expect(scrolled.mock.contexts[0]).toHaveTextContent("Commit o");
    expect(asked(requests, "/api/history").get("skip")).toBe("3");
    expect(screen.getByRole("status")).toHaveTextContent("graph?at=wt-proj-old&clone=clone-proj");
    expect(screen.queryByText(/^Loading towards/)).toBeNull(); // done before its chip said so
    expect(chip("Worktree old")).not.toHaveAttribute("data-busy");
  });

  it("goes to what is not committed in a Checkout, above its HEAD", async () => {
    serveGraph({ clone: { changed: 2 } });
    renderWithQueries(<Graph initial={{ clone: "clone-proj" }} />);
    await screen.findByText("Uncommitted in proj: 2 changed");
    await userEvent.click(chip("Clone proj"));
    await waitFor(() => expect(scrolled).toHaveBeenCalledTimes(1));
    expect(scrolled.mock.contexts[0]).toHaveTextContent("Uncommitted in proj: 2 changed");
  });

  it("says when no page shows the HEAD gone to, on its chip", async () => {
    const graph = { ...GRAPH, heads: [MAIN, elsewhere("lost", "q")] };
    const pages = [COMMITS, [commit("x", ["y"])], [commit("y", [])]];
    serveGraph({ graph, pages, worktrees: ["lost"] });
    renderWithQueries(<Graph initial={{ clone: "clone-proj" }} />);
    await screen.findByText("Commit b");
    await userEvent.click(chip("Worktree lost"));
    expect(
      await screen.findByText("The HEAD of lost is not among the commits shown"),
    ).toBeInTheDocument(); // to screen readers
    expect(chip("Worktree lost")).toHaveAttribute("data-missed", "true");
    expect(chip("Worktree lost")).toHaveAttribute(
      "title",
      expect.stringMatching(
        /; The HEAD of lost is not among the commits shown; a click tries again$/,
      ),
    );
    expect(screen.getByText("Commit y")).toBeInTheDocument(); // all pages loaded
    expect(scrolled).not.toHaveBeenCalled();
  });

  it("turns a chip while going to its HEAD, stopped by a click on it, or by Escape", async () => {
    let release = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const graph = { ...GRAPH, heads: [MAIN, elsewhere("old", "o")] };
    serveGraph({ graph, pages: [COMMITS, [commit("o", [])]], worktrees: ["old"], hold });
    renderWithQueries(<Graph initial={{ clone: "clone-proj" }} />);
    await screen.findByText("Commit b");
    await userEvent.click(chip("Worktree old"));
    expect(await screen.findByText(/^Loading towards old: 3 commits so far$/)).toBeInTheDocument();
    expect(chip("Worktree old")).toHaveAttribute("data-busy", "true");
    expect(chip("Worktree old")).toHaveAttribute(
      "title",
      expect.stringMatching(/; Loading towards old: 3 commits so far; a click or Escape stops$/),
    );
    // said in the chips, not in a note above the list, which would move it
    expect(screen.getByText(/^Loading towards/).closest("nav")).toBe(
      screen.getByRole("navigation", { name: "Checkouts" }),
    );
    await userEvent.click(chip("Worktree old"));
    expect(screen.queryByText(/^Loading towards/)).toBeNull();
    expect(chip("Worktree old")).not.toHaveAttribute("data-busy");
    await userEvent.click(chip("Worktree old")); // focus stays on the chip, in the View
    expect(await screen.findByText(/^Loading towards old/)).toBeInTheDocument();
    fireEvent.keyDown(chip("Worktree old"), { key: "Escape" });
    expect(screen.queryByText(/^Loading towards/)).toBeNull();
    release();
    await screen.findByText("Commit o");
    expect(scrolled).not.toHaveBeenCalled(); // stopped: the page that came does not scroll
  });

  it("shows a hidden branch's chip faint, and shows the branch again on a click", async () => {
    serveGraph();
    renderWithQueries(<Graph initial={{ clone: "clone-proj", hide: ["feature"] }} />);
    await screen.findByText("Commit b");
    expect(chip("Worktree feature")).toHaveAttribute("data-hidden", "true");
    await userEvent.click(chip("Worktree feature"));
    expect(screen.getByRole("status")).toHaveTextContent(
      /^graph\?at=wt-proj-feature&clone=clone-proj$/,
    );
  });

  it("hides the default branch's badge, and its lane and accent, while it is hidden", async () => {
    serveGraph();
    renderWithQueries(<Graph initial={{ clone: "clone-proj", hide: ["main"] }} />);
    await screen.findByText("Commit b");
    expect(screen.queryByTitle("branch, checked out in clone proj")).toBeNull();
    expect(screen.getByTitle("branch, checked out in worktree feature")).toBeInTheDocument();
    // feature in lane 0, main's commit beside it: no lane kept for it
    expect(nodes()).toEqual([
      { kind: "head", x: "-1px" },
      { kind: "head", x: "11px" },
      { kind: "commit", x: "-1px" },
    ]);
    expect(chip("Clone proj").style.getPropertyValue("--chip-colour")).not.toBe("var(--accent)");
  });

  it("opens at a Worktree's HEAD, its chip marked", async () => {
    serveGraph();
    renderWithQueries(<Graph initial={{ clone: "clone-proj", at: "wt-proj-feature" }} />);
    await screen.findByText("Commit b");
    await waitFor(() => expect(scrolled).toHaveBeenCalledTimes(1));
    expect(chip("Worktree feature")).toHaveAttribute("aria-current", "true");
    expect(chip("Clone proj")).not.toHaveAttribute("aria-current");
  });
});

describe("the branch filter of the Graph View", () => {
  const withOld = {
    ...GRAPH,
    branches: [
      ...GRAPH.branches,
      { name: "old", commit: hash("b"), ahead: 0, behind: 1, against: "main" },
    ],
  };
  const status = () => document.querySelector("output"); // its role hidden while the dialog is open
  const open = async () => {
    await userEvent.click(
      screen.getByRole("button", { name: /^All local branches|^Worktrees only/ }),
    );
    return screen.getByRole("dialog", { name: "Branches shown" });
  };
  const listed = (dialog: HTMLElement) =>
    within(dialog)
      .getAllByRole("checkbox")
      .map((box) => [box.closest("label")?.textContent, (box as HTMLInputElement).checked]);

  it("lists the local branches, the default one first, and hides one unticked", async () => {
    const requests = serveGraph({ graph: withOld });
    renderWithQueries(<Graph initial={{ clone: "clone-proj" }} />);
    await screen.findByText("Commit b");
    const dialog = await open();
    expect(within(dialog).getByRole("radio", { name: "All local branches" })).toBeChecked();
    expect(listed(dialog)).toEqual([
      ["main", true],
      ["feature", true],
      ["old", true],
    ]);
    expect(within(dialog).getByRole("button", { name: "Show all" })).toBeDisabled();
    expect(dialog).toHaveTextContent(
      "A hidden branch's commits stay where a branch shown has them.",
    );
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "feature" }));
    expect(status()).toHaveTextContent(/^graph\?clone=clone-proj&hide=feature$/);
    await waitFor(() =>
      expect(asked(requests, "/api/history").getAll("hide")).toEqual(["feature"]),
    );
    expect(screen.getByRole("heading", { hidden: true })).toHaveTextContent(
      "Graph: proj, 1 hidden",
    );
    expect(listed(dialog)).toEqual([
      ["main", true],
      ["feature", false],
      ["old", true],
    ]);
  });

  it("shows only one branch, or all again", async () => {
    serveGraph({ graph: withOld });
    renderWithQueries(<Graph initial={{ clone: "clone-proj" }} />);
    await screen.findByText("Commit b");
    const dialog = await open();
    await userEvent.click(within(dialog).getByRole("button", { name: "Only feature" }));
    expect(status()).toHaveTextContent(/^graph\?clone=clone-proj&hide=main&hide=old$/);
    expect(
      screen.getByRole("button", { name: "All local branches, 2 hidden", hidden: true }),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Show all" }));
    expect(status()).toHaveTextContent(/^graph\?clone=clone-proj$/);
  });

  it("walks only the branches of Checkouts and the default one, when asked", async () => {
    const requests = serveGraph({ graph: withOld });
    renderWithQueries(<Graph initial={{ clone: "clone-proj" }} />);
    await screen.findByText("Commit b");
    const dialog = await open();
    await userEvent.click(
      within(dialog).getByRole("radio", { name: "Branches of worktrees, and the default branch" }),
    );
    expect(status()).toHaveTextContent(/^graph\?branches=worktrees&clone=clone-proj$/);
    await waitFor(() => expect(asked(requests, "/api/history").get("branches")).toBe("worktrees"));
    expect(screen.getByRole("heading", { hidden: true })).toHaveTextContent(
      "Graph: proj, worktrees only",
    );
    expect(listed(dialog)).toEqual([
      ["main", true],
      ["feature", true],
    ]); // not old, in no Checkout
  });
});

describe("links to the Graph View", () => {
  it("from History's bar: of the Clone, at a Worktree's HEAD", async () => {
    serveGraph();
    const opened: unknown[] = [];
    renderWithQueries(
      <OpenViewContext.Provider value={(address) => opened.push(address)}>
        <InPanel view={HistoryView} kind="history" params={{ worktree: "wt-proj-feature" }} />
      </OpenViewContext.Provider>,
    );
    await screen.findByText("Commit b");
    await userEvent.click(await screen.findByRole("button", { name: "Graph of all branches" }));
    expect(opened).toEqual([
      { kind: "graph", params: { clone: "clone-proj", at: "wt-proj-feature" } },
    ]);
  });
});
