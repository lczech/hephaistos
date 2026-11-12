import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
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

/** A feature branch, newest, off main, which the main working tree has out. */
const COMMITS = [
  commit("f", ["b"], { refs: [branch("feature", "f")] }),
  commit("m", ["b"], { refs: [branch("main", "m")] }),
  commit("b", []),
];

const GRAPH: Schemas["GraphJson"] = {
  default_branch: "main",
  branches: [
    { name: "feature", commit: hash("f"), ahead: 1, behind: 1, against: "main" },
    { name: "main", commit: hash("m"), ahead: null, behind: null, against: null },
  ],
  heads: [
    {
      path: "/home/me/proj",
      commit: hash("m"),
      branch: "main",
      main: true,
      clone: "clone-proj",
      worktree: null,
    },
    {
      path: "/home/me/proj/.worktrees/feature",
      commit: hash("f"),
      branch: "feature",
      main: false,
      clone: "clone-proj",
      worktree: "wt-proj-feature",
    },
  ],
};

function serveGraph(): Request[] {
  return serve({
    "GET /api/info": () => json(info()),
    "GET /api/repositories": () =>
      json([repository("proj", [clone("proj", { worktrees: [worktree("proj", "feature")] })])]),
    "GET /api/history": () =>
      json({
        head: hash("m"),
        branch: "main",
        refs: [],
        commits: COMMITS,
        next: null,
        found: null,
      }),
    "GET /api/graph": () => json(GRAPH),
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

function Graph({ initial }: { initial: Params }) {
  return <InPanel view={GraphView} kind="graph" params={initial} />;
}

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
