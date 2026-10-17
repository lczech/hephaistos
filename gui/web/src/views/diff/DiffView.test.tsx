import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Schemas } from "../../api/client";
import type { DiffLook, Versions } from "../../components/diff/Diff";
import { json, renderWithQueries, serve, setting } from "../../test/server";
import { addressText, type Params } from "../address";
import { DiffView } from "./DiffView";

// The renderer draws in a way jsdom can't show; this stand-in shows what it was given.
vi.mock("../../components/diff/LazyDiff", () => ({
  LazyDiff: ({
    patch,
    header,
    look,
    versions,
  }: {
    patch: string;
    header: ReactNode;
    look: DiffLook;
    versions: Versions | undefined;
  }) => (
    <figure>
      <header>{header}</header>
      <pre>{patch}</pre>
      <figcaption>{JSON.stringify(look)}</figcaption>
      <p>{versions ? `versions: ${JSON.stringify(versions)}` : "no versions"}</p>
    </figure>
  ),
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
  { theme = "github-dark", changes = [] as Schemas["ChangeGroupJson"][] } = {},
): Request[] {
  return serve({
    "GET /api/diff": () => json(diff),
    "GET /api/diff/files": () => json({ old: "a\n", new: "b\n" }),
    "GET /api/changes": () => json({ branch: null, groups: changes }),
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
  it("shows a file's diff in a commit", async () => {
    const requests = serveDiff({ change: change(), patch: PATCH });
    const hash = "c".repeat(40);
    renderWithQueries(
      <Diff initial={{ clone: "clone-proj", commit: hash, path: "src/main.py" }} />,
    );
    expect(await screen.findByText(/^diff --git/)).toBeInTheDocument();
    const asked = requests.map((request) => new URL(request.url));
    expect(asked.find((url) => url.pathname === "/api/diff")?.search).toBe(
      `?clone=clone-proj&commit=${hash}&path=src%2Fmain.py&context=5`,
    );
    expect(screen.getByRole("heading")).toHaveTextContent("Diff: main.py, ccccccc");
    expect(within(screen.getByRole("figure")).getByText("ccccccc")).toBeInTheDocument();
  });

  it("shows git's patch, as chosen to look, for all Diffs", async () => {
    const requests = serveDiff({ change: change(), patch: PATCH });
    renderWithQueries(<Diff initial={STAGED} />);
    expect(await screen.findByText(/^diff --git/)).toHaveTextContent("+b");
    expect(screen.getByRole("heading")).toHaveTextContent("Diff: main.py, staged");
    expect(within(screen.getByRole("figure")).getByText("staged")).toBeInTheDocument();
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
    renderWithQueries(<Diff initial={{ ...STAGED, from: "index", to: "worktree" }} />);
    expect(await screen.findByText(/Its changes are now/)).toHaveTextContent(
      /^No changes not staged\. Its changes are now:/,
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
    expect(await screen.findByText(/None left/)).toHaveTextContent(
      "No changes staged. None left: committed, or undone.",
    );
  });

  it("names a code theme it doesn't know", async () => {
    serveDiff({ change: change(), patch: PATCH }, { theme: "no-such-theme" });
    renderWithQueries(<Diff initial={STAGED} />);
    expect(await screen.findByText(/Unknown code theme no-such-theme/)).toBeInTheDocument();
  });

  it("says when no file is named", () => {
    serve({});
    renderWithQueries(<Diff initial={{ clone: "clone-proj" }} />);
    expect(screen.getByText(/No file/)).toBeInTheDocument();
  });
});
