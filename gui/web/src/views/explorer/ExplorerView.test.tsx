import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Schemas } from "../../api/client";
import { clone, info, json, renderWithQueries, repository, serve } from "../../test/server";
import { InPanel } from "../../test/view";
import type { Params } from "../address";
import { ExplorerView, pathParts } from "./ExplorerView";
import type { FileEntry } from "./rows";

function entry(name: string, fields: Partial<FileEntry> = {}): FileEntry {
  return {
    name,
    kind: "file",
    hidden: name.startsWith("."),
    target: null,
    to: null,
    size: null,
    modified: null,
    status: null,
    ignored: null,
    changed: null,
    ...fields,
  };
}

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

const names = () =>
  screen.getAllByRole("listitem").map((row) => row.textContent?.replace(/\s+/g, " ").trim());

describe("the Explorer View", () => {
  it("shows the home directory, folders first, hidden entries in italics", async () => {
    serveDisk();
    renderWithQueries(<Explorer />);
    await screen.findByText("notes.md");
    expect(names()).toEqual(["proj", ".bashrc", "notes.md"]);
    expect(screen.getByRole("heading")).toHaveTextContent("Explorer: me");
    expect(screen.getByText(".bashrc").closest("[class*=hidden]")).not.toBeNull();
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

  it("says why a Directory cannot be listed", async () => {
    serveDisk();
    renderWithQueries(<Explorer initial={{ path: "/nowhere" }} />);
    expect(await screen.findByText(/Could not load: nothing is at \/nowhere/)).toBeInTheDocument();
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
