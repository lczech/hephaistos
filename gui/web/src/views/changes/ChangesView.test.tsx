import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { Schemas } from "../../api/client";
import { cells } from "../../test/list";
import { clone, info, json, renderWithQueries, repository, serve } from "../../test/server";
import { type Address, addressText, type Params } from "../address";
import { type Opening, OpenViewContext, ShownContext } from "../opening";
import { ChangesView } from "./ChangesView";
import type { Change } from "./rows";

function change(path: string, fields: Partial<Change> = {}): Change {
  return {
    path,
    status: "M",
    original: null,
    added: 1,
    removed: 0,
    binary: false,
    size: null,
    old_size: null,
    files: null,
    more_files: false,
    ...fields,
  };
}

const BRANCH = { head: "abc", branch: "main", upstream: "origin/main", ahead: 2, behind: 0 };

/** A Clone with staged, changed and new files, one a new folder, which holds two more. */
function serveChanges(): Request[] {
  const answer: Schemas["ChangesJson"] = {
    branch: BRANCH,
    commit: null,
    groups: [
      {
        name: "staged",
        from: "HEAD",
        to: "index",
        changes: [change("src/app/main.py", { added: 10, removed: 2 })],
        count: 1,
      },
      {
        name: "unstaged",
        from: "index",
        to: "working-tree",
        changes: [
          change("README.md", { added: 3, removed: 1 }),
          change("a.txt", { added: 15, removed: 5 }),
          change("logo.png", {
            added: null,
            removed: null,
            binary: true,
            size: 2000,
            old_size: 1000,
          }),
        ],
        count: 3,
      },
      {
        name: "untracked",
        from: "index",
        to: "working-tree",
        changes: [change("new/", { status: "?", added: null, removed: null, files: 2, size: 30 })],
        count: 1,
      },
    ],
  };
  const inFolder: Schemas["ChangesJson"] = {
    branch: BRANCH,
    commit: null,
    groups: [
      {
        name: "untracked",
        from: "index",
        to: "working-tree",
        changes: [
          change("new/b.txt", { status: "?" }),
          change("new/a.txt", { status: "?", added: 4 }),
        ],
        count: 2,
      },
    ],
  };
  return serve({
    "GET /api/info": () => json(info()),
    "GET /api/repositories": () => json([repository("proj", [clone("proj")])]),
    "GET /api/changes": (request) =>
      json(new URL(request.url).searchParams.get("path") === "new/" ? inFolder : answer),
  });
}

/** The View as a Panel holds it: with its parameters, shown as its address, and its title. */
function Changes({ initial }: { initial: Params }) {
  const [params, setParams] = useState<Params>(initial);
  const [title, setTitle] = useState("");
  return (
    <>
      <output>{addressText({ kind: "changes", params })}</output>
      <h1>{title}</h1>
      <ChangesView params={params} setParams={setParams} setTitle={setTitle} />
    </>
  );
}

/** A row's text, each icon saying what happened: `modified main.py +10 −2`. */
function rowText(row: HTMLElement): string {
  const copy = row.cloneNode(true) as HTMLElement;
  for (const icon of copy.querySelectorAll("[data-kind]")) {
    icon.replaceWith(` ${icon.getAttribute("data-kind")} `);
  }
  return cells(copy).join(" ").replace(/\s+/g, " ").trim();
}

const rows = () => screen.getAllByRole("listitem").map(rowText);

describe("the Changes View", () => {
  it("lists the changes in git's groups, with the branch and totals", async () => {
    serveChanges();
    renderWithQueries(<Changes initial={{ clone: "clone-proj" }} />);
    await screen.findByText("Staged");
    expect(rows()).toEqual([
      "Staged modified 1 +10 −2",
      "src/app/ +10 −2",
      "modified main.py +10 −2",
      "Not staged modified 3 +18 −6",
      "modified README.md +3 −1",
      "modified a.txt +15 −5",
      "modified logo.png binary, 1.0 kB → 2.0 kB",
      "Untracked new folder 1 +0 −0",
      "new folder new/ 2 files, 30 B",
    ]);
    expect(screen.getByText("main ↑2")).toHaveAttribute("title", "main, tracking origin/main");
    expect(screen.getByText("4 files, +28 −8")).toBeInTheDocument();
    expect(screen.getByRole("heading")).toHaveTextContent("Changes: proj");
    expect(screen.getByRole("button", { name: "Groups" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Compare from: HEAD (main)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compare to: Working tree" })).toBeInTheDocument();
  });

  it("compares Revisions picked or swapped, grouping only HEAD's to the working tree", async () => {
    const requests = serve({
      "GET /api/info": () => json(info()),
      "GET /api/repositories": () => json([repository("proj", [clone("proj")])]),
      "GET /api/changes": () => json({ branch: BRANCH, commit: null, groups: [] }),
      "GET /api/history": () =>
        json({
          head: "abc",
          branch: "main",
          refs: [{ name: "v1", full: "refs/tags/v1", kind: "tag", commit: "abc" }],
          commits: [],
          next: null,
          found: null,
        }),
    });
    renderWithQueries(
      <Changes initial={{ clone: "clone-proj", from: "HEAD", to: "working-tree" }} />,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Swap" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "changes?clone=clone-proj&from=working-tree&to=HEAD",
    );
    expect(screen.queryByRole("button", { name: "Groups" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^Compare to: / }));
    await userEvent.click(await screen.findByRole("option", { name: "v1" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "changes?clone=clone-proj&from=working-tree&to=refs%2Ftags%2Fv1",
    );
    expect(screen.getByRole("heading")).toHaveTextContent("Changes: proj, working tree → v1");
    const asked = requests.filter((request) => new URL(request.url).pathname === "/api/changes");
    expect(new URL(asked.at(-1)?.url ?? "").searchParams.get("to")).toBe("refs/tags/v1");
  });

  it("opens a new folder, asking for the files in it, and closes a group", async () => {
    const requests = serveChanges();
    renderWithQueries(<Changes initial={{ clone: "clone-proj" }} />);
    const folder = await screen.findByText("new/");
    await userEvent.click(folder);
    await screen.findByTitle("new/a.txt");
    expect(rows().slice(-3)).toEqual([
      "new folder new/ 2 files, 30 B",
      "added a.txt +4 −0",
      "added b.txt +1 −0",
    ]);
    const asked = requests.map((request) => new URL(request.url).search);
    expect(asked).toContain("?clone=clone-proj&path=new%2F");
    await userEvent.click(screen.getByText("Staged"));
    expect(screen.queryByText("main.py")).toBeNull();
    expect(rows()[0]).toBe("Staged modified 1 +10 −2");
    await userEvent.click(screen.getByText("Staged")); // open again
    await userEvent.click(screen.getByTitle("src/app/"));
    expect(rows().slice(1, 3)).toEqual(["src/app/ +10 −2", "Not staged modified 3 +18 −6"]);
  });

  it("opens a file's diff as a preview, in its Group or beside it by the middle button", async () => {
    serveChanges();
    const opened: [Address, Opening | undefined][] = [];
    renderWithQueries(
      <OpenViewContext.Provider value={(address, opening) => opened.push([address, opening])}>
        <Changes initial={{ clone: "clone-proj" }} />
      </OpenViewContext.Provider>,
    );
    const name = await screen.findByText("main.py");
    await userEvent.click(name);
    const diff = {
      kind: "diff",
      params: { clone: "clone-proj", from: "HEAD", to: "index", path: "src/app/main.py" },
    };
    await userEvent.pointer({ keys: "[MouseMiddle]", target: name });
    expect(opened).toEqual([
      [diff, { beside: false, preview: true }],
      [diff, { beside: true, preview: true }],
    ]);
    // All of them as one Diff: since HEAD, as the groups show them.
    await userEvent.click(screen.getByRole("button", { name: "These changes as one Diff" }));
    expect(opened.at(-1)?.[0]).toEqual({
      kind: "diff",
      params: { clone: "clone-proj", from: "HEAD", to: "working-tree" },
    });
    const row = name.closest("li") as HTMLElement;
    expect(within(row).getByRole("button")).not.toHaveAttribute("aria-expanded");
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.getByTitle("binary, modified")).toBeInTheDocument();
  });

  it("marks the file whose diff is shown", async () => {
    serveChanges();
    const diff = { kind: "diff", params: { clone: "clone-proj", from: "HEAD", to: "index" } };
    renderWithQueries(
      <ShownContext
        value={
          new Set([addressText({ ...diff, params: { ...diff.params, path: "src/app/main.py" } })])
        }
      >
        <Changes initial={{ clone: "clone-proj" }} />
      </ShownContext>,
    );
    const shown = (await screen.findByText("main.py")).closest("[data-showing]");
    expect(shown).not.toBeNull();
    expect(document.querySelectorAll("[data-showing]")).toHaveLength(1);
  });

  it("shows a commit's changes under it, opening their diffs in the commit", async () => {
    const hash = "c".repeat(40);
    const person = { name: "Lucas", email: "lucas@example.org", at: "2026-10-13T10:00:00Z" };
    const answer: Schemas["ChangesJson"] = {
      branch: null,
      commit: {
        name: hash,
        commit: {
          hash,
          parents: ["b".repeat(40)],
          subject: "Fix it",
          body: "Why.",
          author: person,
          committer: person,
          refs: [],
          renamed_from: null,
        },
        reachable: false,
        amended_as: "d".repeat(40),
      },
      groups: [
        { name: "changes", from: "b".repeat(40), to: hash, changes: [change("a.txt")], count: 1 },
      ],
    };
    const requests = serve({
      "GET /api/info": () => json(info()),
      "GET /api/repositories": () => json([repository("proj", [clone("proj")])]),
      "GET /api/changes": () => json(answer),
    });
    const opened: [Address, Opening | undefined][] = [];
    renderWithQueries(
      <OpenViewContext.Provider value={(address, opening) => opened.push([address, opening])}>
        <Changes initial={{ clone: "clone-proj", commit: hash }} />
      </OpenViewContext.Provider>,
    );
    await userEvent.click(await screen.findByText("a.txt"));
    const asked = requests.map((request) => new URL(request.url));
    expect(asked.find((url) => url.pathname === "/api/changes")?.search).toBe(
      `?clone=clone-proj&commit=${hash}`,
    );
    expect(opened[0]?.[0]).toEqual({
      kind: "diff",
      params: { clone: "clone-proj", commit: hash, path: "a.txt" },
    });
    expect(screen.getByRole("heading")).toHaveTextContent("Changes: proj, ccccccc Fix it");
    expect(screen.queryByRole("button", { name: "Groups" })).toBeNull();
    expect(screen.getByText(/^Not on any branch or tag/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Changes in commit ddddddd" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Compare from/ })).toBeNull();
    const header = screen.getByRole("button", { name: /Fix it/ });
    await userEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Why.")).toBeInTheDocument();
    // Other Revisions instead: from its first parent to it, to pick others.
    await userEvent.click(screen.getByRole("button", { name: "Compare with other Revisions" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      `changes?clone=clone-proj&from=${"b".repeat(40)}&to=${hash}`,
    );
    expect(screen.getByRole("button", { name: "Compare to: ccccccc" })).toBeInTheDocument();
  });

  it("says when git has a commit no longer", async () => {
    serve({
      "GET /api/info": () => json(info()),
      "GET /api/repositories": () => json([repository("proj", [clone("proj")])]),
      "GET /api/changes": () =>
        json({
          branch: null,
          groups: [],
          commit: { name: "abc1234", commit: null, reachable: false, amended_as: null },
        }),
    });
    renderWithQueries(<Changes initial={{ clone: "clone-proj", commit: "abc1234" }} />);
    expect(await screen.findByText("abc1234 is no longer in this Checkout.")).toBeInTheDocument();
  });

  it("shows the changes since HEAD together, as chosen in this browser, also after swapping", async () => {
    const requests = serveChanges();
    renderWithQueries(<Changes initial={{ clone: "clone-proj" }} />);
    await screen.findByText("Staged");
    const groups = () => screen.getByRole("button", { name: "Groups" });
    await userEvent.click(groups());
    // How they show isn't what is compared: the address stays, the choice is kept.
    expect(screen.getByRole("status")).toHaveTextContent(/^changes\?clone=clone-proj$/);
    expect(groups()).toHaveAttribute("aria-pressed", "false");
    expect(JSON.parse(localStorage.getItem("hephaistos.changes") ?? "")).toEqual({
      grouped: false,
      nested: false,
    });
    const asked = () =>
      requests.filter((request) => new URL(request.url).pathname === "/api/changes").at(-1)?.url;
    expect(new URL(asked() ?? "").search).toBe("?clone=clone-proj&from=HEAD&to=working-tree");
    await userEvent.click(screen.getByRole("button", { name: "Swap" }));
    expect(screen.getByRole("status")).toHaveTextContent("from=working-tree&to=HEAD");
    expect(screen.queryByRole("button", { name: "Groups" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Swap" }));
    expect(screen.getByRole("status")).toHaveTextContent(/^changes\?clone=clone-proj$/);
    expect(groups()).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(groups());
    expect(await screen.findByText("Staged")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "lines" }));
    expect(screen.getByRole("status")).toHaveTextContent("sort=-lines");
    expect(rows().slice(4, 7)).toEqual([
      "modified a.txt +15 −5",
      "modified README.md +3 −1",
      "modified logo.png binary, 1.0 kB → 2.0 kB",
    ]);
  });

  it("nests directories, as chosen in this browser", async () => {
    const group = { name: "changes" as const, from: "HEAD", to: "working-tree", count: 3 };
    const changes = [change("src/a.py"), change("src/app/main.py"), change("b.txt")];
    serve({
      "GET /api/info": () => json(info()),
      "GET /api/repositories": () => json([repository("proj", [clone("proj")])]),
      "GET /api/changes": () => json({ branch: BRANCH, groups: [{ ...group, changes }] }),
    });
    renderWithQueries(
      <Changes initial={{ clone: "clone-proj", from: "HEAD", to: "working-tree" }} />,
    );
    await screen.findByText("Changes");
    expect(rows().slice(1)).toEqual([
      "src/ +1 −0",
      "modified a.py +1 −0",
      "src/app/ +1 −0",
      "modified main.py +1 −0",
      "modified b.txt +1 −0",
    ]);
    const nested = () => screen.getByRole("button", { name: "Directories as a tree" });
    expect(nested()).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(nested());
    expect(rows().slice(1)).toEqual([
      "src/ +2 −0",
      "app/ +1 −0",
      "modified main.py +1 −0",
      "modified a.py +1 −0",
      "modified b.txt +1 −0",
    ]);
    // Each level a step further in, a directory's chevron with it.
    const main = screen.getByText("main.py").closest("[style]");
    expect(main).toHaveStyle({ "--indent": "2" });
    const app = screen.getByText("app/").closest("li") as HTMLElement;
    expect(app.querySelector("[data-column=square] [style]")).toHaveStyle({ "--indent": "1" });
    expect(JSON.parse(localStorage.getItem("hephaistos.changes") ?? "")).toMatchObject({
      nested: true,
    });
    await userEvent.click(nested()); // as it was, for the other tests
  });

  it("scales the bars to the most lines of any file listed, in new folders too", async () => {
    const group = { name: "untracked" as const, from: "index", to: "working-tree", count: 1 };
    const folder = change("new/", { status: "?", added: null, removed: null, files: 2 });
    const files = [change("new/a.txt", { added: 4 }), change("new/b.txt", { added: 1 })];
    serve({
      "GET /api/info": () => json(info()),
      "GET /api/repositories": () => json([repository("proj", [clone("proj")])]),
      "GET /api/changes": (request) =>
        json({
          branch: BRANCH,
          groups: [
            new URL(request.url).searchParams.get("path") === "new/"
              ? { ...group, changes: files, count: 2 }
              : { ...group, changes: [folder] },
          ],
        }),
    });
    renderWithQueries(
      <Changes initial={{ clone: "clone-proj", from: "index", to: "working-tree" }} />,
    );
    await userEvent.click(await screen.findByText("new/"));
    const meter = async (name: string) =>
      ((await screen.findByText(name)).closest("li") as HTMLElement).querySelector(
        '[style*="--added"]',
      );
    expect(await meter("a.txt")).toHaveStyle({ "--added": "1" });
    expect(await meter("b.txt")).toHaveStyle({ "--added": "0.25" });
  });

  it("shows one group as a header, which doesn't close", async () => {
    const group = { name: "changes" as const, from: "HEAD", to: "working-tree", count: 1 };
    serve({
      "GET /api/info": () => json(info()),
      "GET /api/repositories": () => json([repository("proj", [clone("proj")])]),
      "GET /api/changes": () =>
        json({ branch: BRANCH, groups: [{ ...group, changes: [change("a.txt")] }] }),
    });
    renderWithQueries(
      <Changes initial={{ clone: "clone-proj", from: "HEAD", to: "working-tree" }} />,
    );
    const header = (await screen.findByText("Changes")).closest("li") as HTMLElement;
    expect(within(header).queryByRole("button")).toBeNull();
    await userEvent.click(header);
    expect(rows()).toEqual(["Changes modified 1 +1 −0", "modified a.txt +1 −0"]);
  });

  it("says when a Checkout isn't named", () => {
    serve({});
    renderWithQueries(<Changes initial={{}} />);
    expect(screen.getByText(/No Checkout/)).toBeInTheDocument();
  });
});
