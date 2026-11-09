import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Schemas } from "../../api/client";
import { forgetKept } from "../../kept";
import { noticeAtom } from "../../notice";
import { ownRow } from "../../test/list";
import {
  clone,
  fileEntry,
  info,
  json,
  renderWithQueries,
  repository,
  serve,
} from "../../test/server";
import { expectSettled, InPanel } from "../../test/view";
import type { Params } from "../address";
import { ShownContext } from "../opening";
import { bareDir, ExplorerView, pathParts } from "./ExplorerView";
import type { FileEntry } from "./rows";

const entry = fileEntry;

const DISK: Record<string, FileEntry[]> = {
  "/home/me": [entry("proj", { kind: "directory" }), entry(".bashrc"), entry("notes.md")],
  "/home/me/proj": [entry("main.py"), entry("old", { kind: "symlink", target: "gone" })],
};

function serveDisk(): Request[] {
  return serve({
    "GET /api/info": () => json(info()),
    "GET /api/repositories": () =>
      json([repository("proj", [{ ...clone("proj"), path: "/home/me/proj" }])]),
    "GET /api/files": (request) => {
      const path = new URL(request.url).searchParams.get("path") ?? "";
      const entries = DISK[path];
      if (!entries) return json({ error: `nothing is at ${path}`, checkout: null }, 404);
      const answer: Schemas["FilesJson"] = { path, top: null, entries, count: entries.length };
      return json(answer);
    },
  });
}

function Explorer({ initial = {} }: { initial?: Params }) {
  return <InPanel view={ExplorerView} kind="explorer" params={initial} />;
}

/** The size cell saying `text`, its amount and unit together, if any. */
const sizeCell = (text: string) =>
  [...document.querySelectorAll("[data-column=size]")].find((cell) => cell.textContent === text) ??
  null;

const names = () =>
  screen
    .getAllByRole("listitem")
    .map((row) => ownRow(row).textContent?.replace(/\s+/g, " ").trim());

describe("the Explorer View", () => {
  it("shows the home directory, folders first, hidden entries in italics", async () => {
    serveDisk();
    renderWithQueries(<Explorer />);
    await screen.findByText("notes.md");
    await expectSettled();
    expect(names()).toEqual(["proj", ".bashrc", "notes.md"]);
    expect(screen.getByRole("heading")).toHaveTextContent("Explorer: me");
    expect(screen.getByText(".bashrc").closest("[data-hidden]")).not.toBeNull();
  });

  it("opens a folder, kept so, and leaves hidden entries out when asked", async () => {
    serveDisk();
    const { unmount } = renderWithQueries(<Explorer initial={{ path: "/home/me" }} />);
    const proj = await screen.findByText("proj");
    await userEvent.click(proj);
    await screen.findByText("main.py");
    expect(names()).toEqual(["proj", "main.py", "old", ".bashrc", "notes.md"]);
    expect(screen.getByText("old").closest("span[title]")).toHaveAttribute(
      "title",
      "/home/me/proj/old\nbroken: points to gone",
    );
    await userEvent.click(screen.getByRole("button", { name: "Hidden files" }));
    expect(names()).toEqual(["proj", "main.py", "old", "notes.md"]);
    unmount();

    serveDisk();
    renderWithQueries(<Explorer initial={{ path: "/home/me" }} />);
    await screen.findByText("main.py"); // still open
    await userEvent.click(screen.getByRole("button", { name: "Close all folders" }));
    expect(names()).toEqual(["proj", "notes.md"]);
    await userEvent.click(screen.getByRole("button", { name: "Hidden files" })); // as it was
  });

  it("shows a folder within its root, its path from there, never above", async () => {
    serveDisk();
    const { unmount } = renderWithQueries(
      <Explorer initial={{ path: "/home/me/proj", root: "/home/me" }} />,
    );
    await screen.findByText("main.py");
    const parts = screen.getByRole("button", { name: "me" }).parentElement?.parentElement;
    expect(
      within(parts as HTMLElement)
        .getAllByRole("button")
        .map((part) => part.textContent),
    ).toEqual(["me", "proj"]);
    await userEvent.click(screen.getByRole("button", { name: "me" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "explorer?path=%2Fhome%2Fme&root=%2Fhome%2Fme",
    );
    unmount();
    serveDisk();
    renderWithQueries(<Explorer initial={{ path: "/etc", root: "/home/me" }} />);
    expect(await screen.findByText("notes.md")).toBeInTheDocument(); // its root instead
  });

  it("goes into a folder from its menu, within the same root", async () => {
    serveDisk();
    renderWithQueries(<Explorer initial={{ path: "/home/me", root: "/home/me" }} />);
    fireEvent.contextMenu(await screen.findByText("proj"));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Go into folder" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "explorer?path=%2Fhome%2Fme%2Fproj&root=%2Fhome%2Fme",
    );
    expect(await screen.findByText("main.py")).toBeInTheDocument();
  });

  it("links to the changes and history of the Checkout it shows a folder of", async () => {
    serve({
      "GET /api/info": () => json(info()),
      "GET /api/repositories": () =>
        json([repository("me", [{ ...clone("me"), path: "/home/me", resolved_path: "/home/me" }])]),
      "GET /api/files": (request) => {
        const git = new URL(request.url).searchParams.has("fields");
        const entries = DISK["/home/me"] ?? [];
        return json({ path: "/home/me", top: git ? "/home/me" : null, entries, count: 3 });
      },
    });
    renderWithQueries(<Explorer initial={{ path: "/home/me" }} />);
    expect(await screen.findByRole("button", { name: "Commit history of me" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Changes in me" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Diff of the changes in me" })).toBeInTheDocument();
    // In groups: how it shows, acting on what it shows, other Views.
    const end = screen.getByRole("button", { name: "Refresh" }).parentElement?.parentElement;
    expect(
      [...(end?.children ?? [])].map((group) =>
        [...group.querySelectorAll("button")].map((button) => button.getAttribute("aria-label")),
      ),
    ).toEqual([
      ["Find files and folders by name", "Hidden files"],
      ["Close all folders", "Refresh"],
      ["Commit history of me", "Changes in me", "Diff of the changes in me"],
    ]);
  });

  it("shows a parent by its part of the path in the bar", async () => {
    serveDisk();
    renderWithQueries(<Explorer initial={{ path: "/home/me/proj" }} />);
    await screen.findByText("main.py");
    const bar = screen.getByRole("button", { name: "~" }).parentElement?.parentElement;
    expect(
      within(bar as HTMLElement)
        .getAllByRole("button")
        .map((part) => part.textContent),
    ).toEqual(["~", "proj"]);
    await userEvent.click(screen.getByRole("button", { name: "~" }));
    expect(screen.getByRole("status")).toHaveTextContent("explorer?path=%2Fhome%2Fme");
    await screen.findByText("notes.md");
  });

  it("colours names by git, its letters spelled out, asking for sizes and times only shown", async () => {
    const git: Record<string, Partial<Schemas["FileEntryJson"]>> = {
      proj: { kind: "directory", changed: true, items: 3 },
      "notes.md": {
        status: "M",
        index: "A",
        worktree: "M",
        size: 3400,
        modified: "2026-10-13T11:00:00Z",
      },
      ".bashrc": { ignored: true },
    };
    const asked: string[] = [];
    serve({
      "GET /api/info": () => json(info()),
      "GET /api/repositories": () => json([]),
      "GET /api/files": (request) => {
        const query = new URL(request.url).searchParams;
        asked.push(query.getAll("fields").join(","));
        const fields = new Set(query.getAll("fields"));
        const entries = (DISK["/home/me"] ?? []).map((found) => ({
          ...found,
          ...(fields.has("git") ? git[found.name] : {}),
          size: fields.has("size") ? (git[found.name]?.size ?? null) : null,
          items: fields.has("size") ? (git[found.name]?.items ?? null) : null,
          modified: fields.has("modified") ? (git[found.name]?.modified ?? null) : null,
        }));
        return json({ path: "/home/me", top: "/home/me", entries, count: entries.length });
      },
    });
    const { unmount } = renderWithQueries(<Explorer initial={{ path: "/home/me" }} />);
    await waitFor(() => expect(screen.getByText("notes.md").closest("[data-git]")).not.toBeNull());
    expect(screen.getByText("notes.md").closest("[data-git]")).toHaveAttribute(
      "data-git",
      "modified",
    );
    expect(screen.getByTitle("staged: added; not staged: modified")).toHaveTextContent("M");
    expect(screen.getByTitle("changes below it")).toHaveTextContent("•");
    expect(screen.getByText(".bashrc").closest("[data-ignored]")).not.toBeNull();
    expect(asked).toEqual(["", "git"]); // sizes and times hidden: not asked for
    expect(sizeCell("3.4 kB")).toBeNull();
    unmount();

    localStorage.setItem("hephaistos.lists.explorer.hidden", "[]"); // all columns shown
    forgetKept();
    renderWithQueries(<Explorer initial={{ path: "/home/me" }} />);
    await waitFor(() => expect(sizeCell("3.4 kB")).not.toBeNull());
    expect(sizeCell("3 items")).not.toBeNull(); // a folder's entries
    expect(asked.at(-1)).toBe("git,size,modified");
  });

  it("offers a changed file's Diff and History, and copies its path from its menu", async () => {
    serve({
      "GET /api/info": () => json(info()),
      "GET /api/repositories": () =>
        json([repository("me", [{ ...clone("me"), path: "/home/me", resolved_path: "/home/me" }])]),
      "GET /api/files": (request) => {
        const git = new URL(request.url).searchParams.has("fields");
        const entries = [fileEntry("notes.md", git ? { status: "M", worktree: "M" } : {})];
        return json({ path: "/home/me", top: git ? "/home/me" : null, entries, count: 1 });
      },
    });
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    renderWithQueries(<Explorer initial={{ path: "/home/me" }} />);
    expect(await screen.findByRole("button", { name: "Diff of notes.md" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Commit history of notes.md" })).toBeInTheDocument();
    fireEvent.contextMenu(screen.getByText("notes.md"));
    const menu = await screen.findByRole("menu", { name: "Actions on notes.md" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Diff", "History", "Copy absolute path", "Copy relative path"]);
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Copy relative path" }));
    expect(writeText).toHaveBeenCalledWith("notes.md");
    expect(noticeAtom.get()).toBe("Copied notes.md");
  });

  it("marks a file whose Diff with the working tree is shown, from wherever", async () => {
    serve({
      "GET /api/info": () => json(info()),
      "GET /api/repositories": () =>
        json([repository("me", [{ ...clone("me"), path: "/home/me", resolved_path: "/home/me" }])]),
      "GET /api/files": (request) => {
        const git = new URL(request.url).searchParams.has("fields");
        const entries = [fileEntry("notes.md"), fileEntry("todo.md")];
        return json({ path: "/home/me", top: git ? "/home/me" : null, entries, count: 2 });
      },
    });
    const shown = new Set([
      "diff?clone=clone-me&from=index&to=working-tree&path=notes.md",
      "diff?clone=clone-me&commit=abc1234&path=todo.md",
    ]);
    renderWithQueries(
      <ShownContext value={shown}>
        <Explorer initial={{ path: "/home/me" }} />
      </ShownContext>,
    );
    await waitFor(() =>
      expect(screen.getByText("notes.md").closest("[data-showing]")).not.toBeNull(),
    );
    expect(screen.getByText("todo.md").closest("[data-showing]")).toBeNull();
  });

  it("says why a Directory cannot be listed", async () => {
    serveDisk();
    renderWithQueries(<Explorer initial={{ path: "/nowhere" }} />);
    expect(await screen.findByText(/Could not load: nothing is at \/nowhere/)).toBeInTheDocument();
  });

  it("takes a path and a root typed with a final slash as without", async () => {
    serveDisk();
    renderWithQueries(<Explorer initial={{ path: "/home/me/proj/", root: "/home/me/" }} />);
    await screen.findByText("main.py");
    expect(screen.getByRole("button", { name: "me" })).toHaveAttribute("title", "/home/me");
    expect(screen.getByRole("button", { name: "proj" })).toBeInTheDocument(); // within the root
    expect(bareDir("/")).toBe("/");
    expect(bareDir("//")).toBe("/");
    expect(bareDir("/home/me/proj/../../../etc/")).toBe("/etc"); // not within /home/me/proj
  });

  it("names a path's parts from a limit, by its name", () => {
    expect(pathParts("/home/me/a/b", "/home/me", "/home/me/a")).toEqual([
      ["a", "/home/me/a"],
      ["b", "/home/me/a/b"],
    ]);
    expect(pathParts("/srv/x", "/home/me", "/")[0]).toEqual(["/", "/"]);
  });

  it("names a path's parts from home or the root", () => {
    expect(pathParts("/home/me/a/b", "/home/me")).toEqual([
      ["~", "/home/me"],
      ["a", "/home/me/a"],
      ["b", "/home/me/a/b"],
    ]);
    expect(pathParts("/srv/x", "/home/me")).toEqual([
      ["/", "/"],
      ["srv", "/srv"],
      ["x", "/srv/x"],
    ]);
    expect(pathParts("/home/meadow", "/home/me")[0]).toEqual(["/", "/"]);
  });
});
