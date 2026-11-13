import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import type { Schemas } from "../../api/client";
import { listRows } from "../../test/list";
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
  graph?: Schemas["GraphJson"] | (() => Schemas["GraphJson"]); // as `pages`
  // The pages of commits, in order; asked again for each request, as a repository changes.
  pages?: Commit[][] | (() => Commit[][]);
  only?: Record<string, string[]>; // commits only on a branch, left out of a walk hiding it
  clone?: Partial<Schemas["CloneJson"]> | (() => Partial<Schemas["CloneJson"]>); // as `pages`
  worktrees?: string[] | (() => string[]); // as `pages`
  // Pages after the first wait for it; or, as a function, each page asked for, from `skip`.
  hold?: Promise<void> | ((skip: number) => Promise<void> | undefined);
  holdLines?: Promise<void>; // the lines laid out ahead wait for it
}

function serveGraph({
  graph = GRAPH,
  pages: paged = [COMMITS],
  only = {},
  clone: fields = {},
  worktrees = ["feature"],
  hold,
  holdLines,
}: Served = {}): Request[] {
  // The pages of a walk hiding these branches: without the commits only on them.
  const walked = (hide: string[]) => {
    const left = new Set(hide.flatMap((name) => (only[name] ?? []).map(hash)));
    const pages = typeof paged === "function" ? paged() : paged;
    return pages.map((page) => page.filter((each) => !left.has(each.hash)));
  };
  return serve({
    "GET /api/info": () => json(info()),
    "GET /api/repositories": () => {
      const names = typeof worktrees === "function" ? worktrees() : worktrees;
      const more = typeof fields === "function" ? fields() : fields;
      return json([
        repository("proj", [
          clone("proj", { worktrees: names.map((name) => worktree("proj", name)), ...more }),
        ]),
      ]);
    },
    "GET /api/history": async (request) => {
      const asked = new URL(request.url).searchParams;
      const skip = Number(asked.get("skip") ?? 0);
      const pages = walked(asked.getAll("hide"));
      const refs = walked([])
        .flat()
        .flatMap((each) => each.refs); // all, hidden or not
      const ref = asked.get("ref"); // a revision resolved: as if git knew any, as a commit
      if (ref !== null) {
        return json({
          head: hash("m"),
          branch: "main",
          refs,
          commits: [commit(ref, [])],
          next: null,
          found: null,
        });
      }
      if (typeof hold === "function") await hold(skip);
      else if (skip > 0 && hold) await hold;
      // From `skip` in the walk as it is now, as git skips, to where its page ends: a page
      // asked for by where the walk was before may start elsewhere in it.
      const flat = pages.flat();
      let end = 0;
      for (const page of pages) if (end <= skip) end += page.length;
      end = Math.max(end, skip);
      const search = asked.get("search")?.toLowerCase(); // in messages: here their subjects
      const commits = flat
        .slice(skip, end)
        .filter((each) => !search || each.subject.toLowerCase().includes(search));
      return json({
        head: hash("m"),
        branch: "main",
        refs,
        commits,
        next: end >= flat.length ? null : { start: null, path: null, skip: end },
        found: null,
      });
    },
    "GET /api/graph": () => json(typeof graph === "function" ? graph() : graph),
    "GET /api/graph/lines": async (request) => {
      if (holdLines) await holdLines;
      const asked = new URL(request.url).searchParams;
      const left = new Set(asked.getAll("until"));
      const lines = [];
      for (const { hash: at, parents, refs } of walked(asked.getAll("hide")).flat()) {
        lines.push({ hash: at, parents, refs });
        left.delete(at);
        if (left.size === 0) break;
      }
      return json({ commits: lines });
    },
  });
}

/** The parameters of the last request to a path. */
const asked = (requests: Request[], path: string) =>
  new URL(
    requests.filter((request) => new URL(request.url).pathname === path).at(-1)?.url ??
      "http://none",
  ).searchParams;

const nodes = () =>
  [...document.querySelectorAll<SVGElement>("svg[data-node]")].map((node) => ({
    kind: node.getAttribute("data-node"),
    x: node.style.getPropertyValue("--node-x"),
  }));

const chip = (name: string) => screen.getByRole("button", { name });
const colour = (element: HTMLElement) => element.style.getPropertyValue("--chip-colour");

function Graph({ initial }: { initial: Params }) {
  return <InPanel view={GraphView} kind="graph" params={initial} />;
}

// Where the Graph went: the rows it marked for a moment (`flash`), as the List goes to them.
let went: MockInstance<Element["animate"]>;
beforeEach(() => {
  went = vi.spyOn(Element.prototype, "animate");
});
afterEach(() => {
  vi.unstubAllGlobals();
  went.mockRestore();
});

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

  it("asks again for commits, branches and lines on refresh", async () => {
    const requests = serveGraph();
    renderWithQueries(<Graph initial={{ clone: "clone-proj" }} />);
    await screen.findByText("Commit b");
    await expectSettled();
    const paths = ["/api/history", "/api/graph", "/api/graph/lines"];
    const count = () =>
      paths.map(
        (path) => requests.filter((request) => new URL(request.url).pathname === path).length,
      );
    const before = count();
    await userEvent.click(screen.getByRole("button", { name: /^Refresh/ }));
    await waitFor(() => expect(count()).toEqual(before.map((n) => n + 1)));
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

  it("marks each chip in the colour of its HEAD's line, as its badge is framed", async () => {
    const requests = serveGraph();
    renderWithQueries(<Graph initial={{ clone: "clone-proj", hide: ["old"] }} />);
    await screen.findByText("Commit b");
    const feature = screen.getByTitle("branch, checked out in worktree feature");
    await waitFor(() =>
      expect(colour(chip("Worktree feature"))).toBe(feature.style.getPropertyValue("--ref-colour")),
    );
    expect(colour(chip("Worktree feature"))).not.toBe("");
    expect(colour(chip("Clone proj"))).toBe("var(--accent)");
    const lines = asked(requests, "/api/graph/lines");
    expect(lines.getAll("until").sort()).toEqual([hash("f"), hash("m")]);
    expect([lines.get("branches"), lines.get("order"), lines.get("limit")]).toEqual([
      "local",
      "topo",
      "10000",
    ]);
    expect(lines.getAll("hide")).toEqual(["old"]);
  });

  it("marks the chip of a HEAD on another branch's line in that line's colour", async () => {
    // old's HEAD is on main's line, below main's tip: in the accent, as its badge.
    const old: Head = { ...FEATURE, path: "/home/me/proj/.worktrees/old", branch: "old" };
    const graph = {
      ...GRAPH,
      heads: [MAIN, { ...old, commit: hash("b"), worktree: "wt-proj-old" }],
    };
    const pages = [
      [COMMITS[0] as Commit, COMMITS[1] as Commit, commit("b", [], { refs: [branch("old", "b")] })],
    ];
    serveGraph({ graph, pages, worktrees: ["old"] });
    renderWithQueries(<Graph initial={{ clone: "clone-proj" }} />);
    await screen.findByText("Commit b");
    await waitFor(() => expect(colour(chip("Worktree old"))).toBe("var(--accent)"));
    expect(
      screen
        .getByTitle("branch, checked out in worktree old")
        .style.getPropertyValue("--ref-colour"),
    ).toBe("var(--accent)");
  });

  it("marks no chip but the default branch's until the lines are laid out", async () => {
    serveGraph({ holdLines: new Promise(() => {}) });
    renderWithQueries(<Graph initial={{ clone: "clone-proj" }} />);
    await screen.findByText("Commit b");
    expect(colour(chip("Clone proj"))).toBe("var(--accent)");
    expect(colour(chip("Worktree feature"))).toBe("");
  });

  it("shows what is not committed in a Checkout above its HEAD", async () => {
    serveGraph({ clone: { changed: 2, untracked: 1 } });
    renderWithQueries(<Graph initial={{ clone: "clone-proj" }} />);
    const text = await screen.findByText("Uncommitted in proj: 2 changed, 1 untracked");
    const items = listRows();
    const at = items.findIndex((item) => item.contains(text));
    expect(items[at + 1]).toHaveTextContent("Commit m");
    expect(
      within(items[at] as HTMLElement).getByRole("button", { name: "Uncommitted changes" }),
    ).toBeInTheDocument();
    expect(nodes().map((node) => node.kind)).toEqual(["head", "uncommitted", "head", "commit"]);
  });

  describe("with the repository changed on the way to a HEAD", () => {
    const graph = { ...GRAPH, heads: [MAIN, FEATURE, elsewhere("old", "o")] };
    const OLD = [commit("o", [])];

    /**
     * Goes to old's HEAD on a page held back, then refreshes with the walk changed so: the walk's
     * first page held back too, as git takes a while, while the page before may be asked for.
     */
    async function refreshedOnTheWay(changed: Commit[][]) {
      const held = () => {
        let release = () => {};
        const promise = new Promise<void>((resolve) => {
          release = resolve;
        });
        return { promise, release };
      };
      const [older, first] = [held(), held()];
      let now = [COMMITS, OLD];
      let refreshed = false;
      const hold = (skip: number) =>
        skip > 0 ? older.promise : refreshed ? first.promise : undefined;
      const requests = serveGraph({ graph, pages: () => now, worktrees: ["old"], hold });
      renderWithQueries(<Graph initial={{ clone: "clone-proj" }} />);
      await screen.findByText("Commit b");
      await userEvent.click(chip("Worktree old"));
      await waitFor(() => expect(asked(requests, "/api/history").get("skip")).toBe("3"));
      [now, refreshed] = [changed, true];
      const before = requests.length;
      await userEvent.click(screen.getByRole("button", { name: /^Refresh/ }));
      const refetching = () =>
        requests
          .slice(before)
          .some((request) => new URL(request.url).searchParams.get("skip") === null);
      await waitFor(() => expect(refetching()).toBe(true));
      await new Promise((done) => setTimeout(done, 100)); // a while, for what git takes
      first.release();
      older.release();
      // The pages asked for after: from the walk as it is now, none from where it was.
      return () =>
        requests
          .slice(before)
          .filter((request) => new URL(request.url).pathname === "/api/history")
          .map((request) => new URL(request.url).searchParams.get("skip") ?? "0");
    }

    /** Gone to old's HEAD, its commit at the top, once there. */
    async function wentToOld() {
      await waitFor(() => expect(went).toHaveBeenCalledTimes(1));
      expect(went.mock.contexts[0]).toHaveTextContent("Commit o");
    }

    it("lists a commit made meanwhile, its loading not cut short by the next page's", async () => {
      const asked = await refreshedOnTheWay([[commit("n", ["f"]), ...COMMITS], OLD]);
      await wentToOld();
      const skips = asked();
      expect(screen.getByText("Commit n")).toBeInTheDocument();
      expect(skips).not.toContain("3");
    });

    it("loads on from where the walk is after a reset, not past commits", async () => {
      const asked = await refreshedOnTheWay([COMMITS.slice(1), OLD]); // f reset away
      await wentToOld();
      const skips = asked();
      await waitFor(() => expect(screen.queryByText("Commit f")).toBeNull());
      expect(skips).not.toContain("3");
      expect(listRows().map((row) => row.textContent?.match(/Commit \w/)?.[0])).toEqual([
        "Commit m",
        "Commit b",
        "Commit o",
      ]);
    });

    it("says its HEAD is not among the commits shown once a rewrite removed it", async () => {
      await refreshedOnTheWay([COMMITS]); // old's commit gone, e.g. its Worktree reset
      expect(
        await screen.findByText("The HEAD of old is not among the commits shown"),
      ).toBeTruthy();
      expect(went).not.toHaveBeenCalled();
    });
  });

  it("leaves the focus where it went meanwhile, outside the View, marking the HEAD all the same", async () => {
    let release = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const graph = { ...GRAPH, heads: [MAIN, FEATURE, elsewhere("old", "o")] };
    serveGraph({ graph, pages: [COMMITS, [commit("o", [])]], worktrees: ["old"], hold });
    renderWithQueries(<Graph initial={{ clone: "clone-proj" }} />);
    await screen.findByText("Commit b");
    await userEvent.click(chip("Worktree old"));
    const away = document.body.appendChild(document.createElement("input"));
    away.focus(); // e.g. a terminal in another Group
    release();
    await waitFor(() => expect(went).toHaveBeenCalledTimes(1));
    expect(went.mock.contexts[0]).toHaveTextContent("Commit o");
    expect(document.activeElement).toBe(away);
    away.remove();
  });

  it("goes on to a HEAD with the order toggled on the way, in the walk in the new order", async () => {
    let release = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const graph = { ...GRAPH, heads: [MAIN, FEATURE, elsewhere("old", "o")] };
    const requests = serveGraph({
      graph,
      pages: [COMMITS, [commit("o", [])]],
      worktrees: ["old"],
      hold,
    });
    renderWithQueries(<Graph initial={{ clone: "clone-proj" }} />);
    await screen.findByText("Commit b");
    await userEvent.click(chip("Worktree old"));
    await waitFor(() => expect(asked(requests, "/api/history").get("skip")).toBe("3"));
    await userEvent.click(screen.getByRole("button", { name: "Topological order" }));
    await waitFor(() => expect(asked(requests, "/api/history").get("order")).toBe("date"));
    release();
    await waitFor(() => expect(went).toHaveBeenCalledTimes(1));
    expect(went.mock.contexts[0]).toHaveTextContent("Commit o");
    expect(screen.queryByText(/is not among the commits shown/)).toBeNull();
  });

  it("goes to a HEAD not loaded yet, loading older pages until it shows at the top", async () => {
    const graph = { ...GRAPH, heads: [MAIN, FEATURE, elsewhere("old", "o")] };
    const requests = serveGraph({ graph, pages: [COMMITS, [commit("o", [])]], worktrees: ["old"] });
    renderWithQueries(<Graph initial={{ clone: "clone-proj" }} />);
    await screen.findByText("Commit b");
    expect(screen.queryByText("Commit o")).toBeNull();
    await userEvent.click(chip("Worktree old"));
    await screen.findByText("Commit o");
    await waitFor(() => expect(went).toHaveBeenCalledTimes(1));
    expect(went.mock.contexts[0]).toHaveTextContent("Commit o");
    expect(document.activeElement).toHaveTextContent("Commit o"); // the row, focused
    expect(asked(requests, "/api/history").get("skip")).toBe("3");
    expect(screen.getByRole("status")).toHaveTextContent(/^graph\?clone=clone-proj$/); // a jump only
    expect(screen.queryByText(/^Loading towards/)).toBeNull(); // done before its chip said so
    expect(chip("Worktree old")).not.toHaveAttribute("data-busy");
  });

  it("goes to what is not committed in a Checkout, above its HEAD", async () => {
    serveGraph({ clone: { changed: 2 } });
    renderWithQueries(<Graph initial={{ clone: "clone-proj" }} />);
    await screen.findByText("Uncommitted in proj: 2 changed");
    await userEvent.click(chip("Clone proj"));
    await waitFor(() => expect(went).toHaveBeenCalledTimes(1));
    expect(went.mock.contexts[0]).toHaveTextContent("Uncommitted in proj: 2 changed");
  });

  it("says on its chip when the HEAD gone to is not on the walk, as the lines show", async () => {
    const graph = { ...GRAPH, heads: [MAIN, elsewhere("lost", "q")] };
    const pages = [COMMITS, [commit("x", ["y"])], [commit("y", [])]];
    const requests = serveGraph({ graph, pages, worktrees: ["lost"] });
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
    // known from the lines, which walked all without it: no page after page to look in
    expect(asked(requests, "/api/graph/lines").getAll("until")).toEqual([hash("q")]);
    expect(screen.queryByText("Commit y")).toBeNull();
    expect(went).not.toHaveBeenCalled();
  });

  it("says no longer that a HEAD is not shown once a refresh shows it", async () => {
    const graph = { ...GRAPH, heads: [MAIN, elsewhere("lost", "q")] };
    let pages = [COMMITS];
    serveGraph({ graph, pages: () => pages, worktrees: ["lost"] });
    renderWithQueries(<Graph initial={{ clone: "clone-proj" }} />);
    await screen.findByText("Commit b");
    await userEvent.click(chip("Worktree lost"));
    await screen.findByText("The HEAD of lost is not among the commits shown");
    pages = [[commit("q", ["m"]), ...COMMITS]]; // its branch shown again, by git or by hand
    await userEvent.click(screen.getByRole("button", { name: /^Refresh/ }));
    await screen.findByText("Commit q");
    expect(screen.queryByText(/is not among the commits shown/)).toBeNull();
    expect(chip("Worktree lost")).not.toHaveAttribute("data-missed");
  });

  it("waits in the lines laid out ahead only for HEADs walked, not of hidden branches", async () => {
    const requests = serveGraph({ only: { feature: ["f"] } });
    renderWithQueries(<Graph initial={{ clone: "clone-proj", hide: ["feature"] }} />);
    await screen.findByText("Commit b");
    await expectSettled();
    // feature's HEAD on no line walked: waited for, the lines would be walked to their limit
    expect(asked(requests, "/api/graph/lines").getAll("until")).toEqual([hash("m")]);
  });

  it("pins the default branch where the rows have it, before the branches say it moved", async () => {
    // A commit just made on main: the rows have it, the branches still say main is at m.
    const made = commit("n", ["m"], { refs: [branch("main", "n")] });
    serveGraph({
      pages: [
        [made, COMMITS[0] as Commit, { ...(COMMITS[1] as Commit), refs: [] }, COMMITS[2] as Commit],
      ],
    });
    renderWithQueries(<Graph initial={{ clone: "clone-proj" }} />);
    await screen.findByText("Commit n");
    await expectSettled();
    // n in lane 0, from the top, as main is; feature beside it; m below n in lane 0 too.
    expect(nodes().map((node) => node.x)).toEqual(["-1px", "11px", "-1px", "-1px"]);
  });

  it("tells apart Checkouts in folders of the same name, detached at one commit", async () => {
    const twin = (path: string, worktree: string): Head => ({
      ...elsewhere("twin", "b"),
      path,
      worktree,
    });
    serveGraph({
      graph: {
        ...GRAPH,
        heads: [MAIN, twin("/home/me/a/twin", "wt-a"), twin("/home/me/b/twin", "wt-b")],
      },
      worktrees: ["twin"],
    });
    const errors = vi.spyOn(console, "error");
    renderWithQueries(<Graph initial={{ clone: "clone-proj" }} />);
    await screen.findByText("Commit b");
    const title = `HEAD of worktree twin, detached at ${hash("b").slice(0, 7)}`;
    expect(screen.getAllByTitle(title)).toHaveLength(2);
    expect(errors.mock.calls.flat().join(" ")).not.toMatch(/same key/);
    errors.mockRestore();
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
    expect(await screen.findByText(/^Loading towards old$/)).toBeInTheDocument(); // said once
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
    expect(went).not.toHaveBeenCalled(); // stopped: the page that came is not gone to
  });

  it("shows a hidden branch's chip faint, and shows the branch again on a click", async () => {
    serveGraph({ only: { feature: ["f"] } });
    renderWithQueries(<Graph initial={{ clone: "clone-proj", hide: ["feature"] }} />);
    await screen.findByText("Commit b");
    expect(screen.queryByText("Commit f")).toBeNull();
    expect(chip("Worktree feature")).toHaveAttribute("data-hidden", "true");
    await userEvent.click(chip("Worktree feature"));
    expect(screen.getByRole("status")).toHaveTextContent(/^graph\?clone=clone-proj$/);
    // Gone to once the walk showing it has come, not missed in the one before.
    await waitFor(() => expect(went).toHaveBeenCalledTimes(1));
    expect(went.mock.contexts[0]).toHaveTextContent("Commit f");
    expect(screen.queryByText(/is not among the commits shown/)).toBeNull();
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
    await waitFor(() => expect(went).toHaveBeenCalledTimes(1));
    expect(chip("Worktree feature")).toHaveAttribute("aria-current", "true");
    expect(chip("Clone proj")).not.toHaveAttribute("aria-current");
    await userEvent.click(chip("Clone proj")); // a jump: still opened at the Worktree
    await waitFor(() => expect(went).toHaveBeenCalledTimes(2));
    expect(went.mock.contexts[1]).toHaveTextContent("Commit m");
    expect(chip("Worktree feature")).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("status")).toHaveTextContent(
      /^graph\?at=wt-proj-feature&clone=clone-proj$/,
    );
  });
});

describe("the Graph View as its repository changes", () => {
  const MAIN_BRANCH = { name: "main", commit: hash("m"), ahead: null, behind: null, against: null };
  // A row's subject: a commit's, named by a letter, or what is not committed.
  const subjects = () =>
    listRows().map(
      (row) =>
        row.textContent?.match(/Commit [a-z](?![a-z])|Uncommitted in proj: \d+ changed/)?.[0],
    );

  it("shows a rebase once told: the old commits gone, the branch and its HEAD moved", async () => {
    let rebased = false;
    const after = [commit("g", ["m"], { refs: [branch("feature", "g")] }), ...COMMITS.slice(1)];
    const moved = {
      ...GRAPH,
      branches: [
        { name: "feature", commit: hash("g"), ahead: 1, behind: 0, against: "main" },
        MAIN_BRANCH,
      ],
      heads: [MAIN, { ...FEATURE, commit: hash("g"), behind: 0 }],
    };
    serveGraph({
      pages: () => [rebased ? after : COMMITS],
      graph: () => (rebased ? moved : GRAPH),
    });
    const { client } = renderWithQueries(<Graph initial={{ clone: "clone-proj" }} />);
    await screen.findByText("Commit f");
    rebased = true;
    await client.invalidateQueries(); // as a live hint does
    await screen.findByText("Commit g");
    expect(subjects()).toEqual(["Commit g", "Commit m", "Commit b"]);
    expect(
      within(listRows()[0] as HTMLElement).getByTitle("branch, checked out in worktree feature"),
    ).toBeInTheDocument();
    expect(chip("Worktree feature")).toHaveAttribute(
      "title",
      expect.stringContaining("1 ahead of main;"),
    );
  });

  it("moves what is not committed above its HEAD as it moves, gone while clean", async () => {
    let step = 0;
    const committed = [
      commit("n", ["m"], { refs: [branch("main", "n")] }),
      ...COMMITS.map((each) => ({ ...each, refs: each.hash === hash("m") ? [] : each.refs })),
    ];
    const moved = {
      ...GRAPH,
      branches: [GRAPH.branches[0] ?? MAIN_BRANCH, { ...MAIN_BRANCH, commit: hash("n") }],
      heads: [{ ...MAIN, commit: hash("n") }, FEATURE],
    };
    serveGraph({
      pages: () => [step === 0 ? COMMITS : committed],
      graph: () => (step === 0 ? GRAPH : moved),
      clone: () => ({ changed: [2, 0, 1][step] ?? 0 }),
    });
    const { client } = renderWithQueries(<Graph initial={{ clone: "clone-proj" }} />);
    await screen.findByText("Uncommitted in proj: 2 changed");
    expect(subjects()).toEqual([
      "Commit f",
      "Uncommitted in proj: 2 changed",
      "Commit m",
      "Commit b",
    ]);
    step = 1; // committed
    await client.invalidateQueries();
    await screen.findByText("Commit n");
    await waitFor(() => expect(screen.queryByText(/^Uncommitted in proj/)).toBeNull());
    step = 2; // changed again
    await client.invalidateQueries();
    await screen.findByText("Uncommitted in proj: 1 changed");
    expect(subjects()).toEqual([
      "Uncommitted in proj: 1 changed",
      "Commit n",
      "Commit f",
      "Commit m",
      "Commit b",
    ]);
  });

  it("drops the chip of a Worktree removed, its branch drawn as any other", async () => {
    let removed = false;
    serveGraph({
      graph: () => (removed ? { ...GRAPH, heads: [MAIN] } : GRAPH),
      worktrees: () => (removed ? [] : ["feature"]),
    });
    const { client } = renderWithQueries(<Graph initial={{ clone: "clone-proj" }} />);
    await screen.findByText("Commit f");
    expect(chip("Worktree feature")).toBeInTheDocument();
    removed = true;
    await client.invalidateQueries();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Worktree feature" })).toBeNull(),
    );
    expect(screen.queryByTitle("branch, checked out in worktree feature")).toBeNull();
    expect(screen.getByText("feature")).toBeInTheDocument(); // its badge, as a branch's
    expect(nodes().map((node) => node.kind)).toEqual(["commit", "head", "commit"]);
  });
});

describe("going to a branch, tag or commit in the Graph View", () => {
  // Named for what a click does: going, or stopping.
  const goTo = () =>
    screen.getByRole("button", { name: /^(Go to a branch, tag or commit|Stop loading towards)/ });
  const picker = () => screen.getByRole("dialog", { name: "Branch, tag or commit to go to" });

  it("goes to a branch picked, loading older pages until it shows", async () => {
    const pages = [COMMITS, [commit("o", [], { refs: [branch("old", "o")] })]];
    const graph = {
      ...GRAPH,
      branches: [
        ...GRAPH.branches,
        { name: "old", commit: hash("o"), ahead: 0, behind: 3, against: "main" },
      ],
    };
    const requests = serveGraph({ graph, pages });
    renderWithQueries(<Graph initial={{ clone: "clone-proj" }} />);
    await screen.findByText("Commit b");
    expect(goTo()).toHaveTextContent("Go to…");
    await userEvent.click(goTo());
    await userEvent.click(await within(picker()).findByRole("option", { name: "old" }));
    await screen.findByText("Commit o");
    await waitFor(() => expect(went).toHaveBeenCalledTimes(1));
    expect(went.mock.contexts[0]).toHaveTextContent("Commit o");
    await waitFor(() => expect(document.activeElement).toHaveTextContent("Commit o"));
    expect(goTo()).toHaveTextContent("Go to…"); // holding nothing
    expect(screen.getByRole("status")).toHaveTextContent(/^graph\?clone=clone-proj$/); // nor kept
    // Its commits are searched for in the Graph's walk; remote branches not offered.
    const searched = requests
      .map((request) => new URL(request.url))
      .filter((url) => url.pathname === "/api/history" && url.searchParams.has("everywhere"));
    expect(searched).toEqual([]);
  });

  it("shows a hidden branch picked again, then goes to it", async () => {
    serveGraph({ only: { feature: ["f"] } });
    renderWithQueries(<Graph initial={{ clone: "clone-proj", hide: ["feature"] }} />);
    await screen.findByText("Commit b");
    await userEvent.click(goTo());
    await userEvent.click(await within(picker()).findByRole("option", { name: "feature" }));
    expect(screen.getByRole("status")).toHaveTextContent(/^graph\?clone=clone-proj$/);
    await waitFor(() => expect(went).toHaveBeenCalledTimes(1));
    expect(went.mock.contexts[0]).toHaveTextContent("Commit f");
    expect(screen.queryByText(/is not among the commits shown/)).toBeNull();
  });

  it("turns while going to what was picked, stopped by a click on it", async () => {
    let release = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pages = [COMMITS, [commit("o", [], { refs: [branch("old", "o")] })]];
    serveGraph({ pages, hold });
    renderWithQueries(<Graph initial={{ clone: "clone-proj" }} />);
    await screen.findByText("Commit b");
    await userEvent.click(goTo());
    await userEvent.click(await within(picker()).findByRole("option", { name: "old" }));
    await waitFor(() => expect(goTo()).toHaveAttribute("data-busy", "true"));
    expect(goTo()).toHaveAttribute(
      "title",
      "Loading towards old: 3 commits so far; a click or Escape stops",
    );
    expect(screen.getByText(/^Loading towards old$/)).toBeInTheDocument(); // to screen readers
    expect(goTo()).toHaveAccessibleName("Stop loading towards old");
    await userEvent.click(goTo());
    expect(goTo()).not.toHaveAttribute("data-busy");
    expect(screen.queryByRole("dialog", { name: "Branch, tag or commit to go to" })).toBeNull(); // stopped, not opened
    release();
    await screen.findByText("Commit o");
    expect(went).not.toHaveBeenCalled();
  });

  it("says on the button when what was picked is not on the walk", async () => {
    const requests = serveGraph();
    renderWithQueries(<Graph initial={{ clone: "clone-proj" }} />);
    await screen.findByText("Commit b");
    await userEvent.click(goTo());
    const field = within(picker()).getByRole("searchbox");
    await userEvent.type(field, "abc1234");
    await within(picker()).findByText("Nothing matches."); // searched: no commit, so resolved
    await userEvent.type(field, "{Enter}");
    expect(await screen.findByText("abc1234 is not among the commits shown")).toBeInTheDocument();
    expect(goTo()).toHaveAttribute("data-missed", "true");
    expect(goTo()).toHaveAttribute("title", "abc1234 is not among the commits shown; pick another");
    expect(asked(requests, "/api/graph/lines").getAll("until")).toEqual([hash("abc1234")]);
    expect(went).not.toHaveBeenCalled();
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
