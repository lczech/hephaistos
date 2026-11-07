import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Schemas } from "../../api/client";
import { ownRow } from "../../test/list";
import { fileEntry, info, json, renderWithQueries, serve } from "../../test/server";
import { InPanel } from "../../test/view";
import type { Params } from "../address";
import { ExplorerView } from "./ExplorerView";
import type { FileEntry } from "./rows";

const entry = fileEntry;
const folder = (name: string) => entry(name, { kind: "directory" });

/** A disk, by folder: what each holds. */
const DISK: Record<string, FileEntry[]> = {
  "/home/me": [folder("proj"), folder("deep"), entry(".bashrc"), entry("notes.md")],
  "/home/me/proj": [entry("main.py"), entry("old", { kind: "symlink", target: "gone" })],
  "/home/me/deep": [folder("inner")],
  "/home/me/deep/inner": [entry("x.txt")],
};

/** Every path below a folder of the disk, as the Server lists them: folders ending in `/`. */
function pathsBelow(path: string, prefix = ""): string[] {
  return (DISK[path] ?? []).flatMap((found) =>
    found.kind === "directory"
      ? [
          `${prefix}${found.name}/`,
          ...pathsBelow(`${path}/${found.name}`, `${prefix}${found.name}/`),
        ]
      : [`${prefix}${found.name}`],
  );
}

/** Serves the disk; the listing of paths `refused` with 403 if so. */
function serveDisk({ refused = false } = {}): Request[] {
  return serve({
    "GET /api/info": () => json(info()),
    "GET /api/repositories": () => json([]),
    "GET /api/files": (request) => {
      const path = new URL(request.url).searchParams.get("path") ?? "";
      const entries = DISK[path] ?? [];
      return json({ path, top: null, entries, count: entries.length });
    },
    "GET /api/files/paths": (request) => {
      const query = new URL(request.url).searchParams;
      const path = query.get("path") ?? "";
      if (refused) return json({ error: `not allowed to list ${path}`, checkout: null }, 403);
      const all = pathsBelow(path);
      const hidden = query.get("hidden") !== "false";
      const paths = all.filter(
        (found) => hidden || !found.split("/").some((part) => part.startsWith(".")),
      );
      const answer: Schemas["PathsJson"] = {
        path,
        paths: paths.sort(),
        stopped: null,
        limit: null,
      };
      return json(answer);
    },
  });
}

const names = () =>
  screen
    .getAllByRole("listitem")
    .map((row) => ownRow(row).textContent?.replace(/\s+/g, " ").trim());

const field = () => screen.getByRole("textbox", { name: "Find files and folders by name" });

/** Shows the Explorer at `path`, its find row opened, `text` typed, if any. */
async function finding(text: string, initial: Params = { path: "/home/me" }) {
  renderWithQueries(<InPanel view={ExplorerView} kind="explorer" params={initial} />);
  await waitFor(() => expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0));
  await userEvent.click(screen.getByRole("button", { name: "Find files and folders by name" }));
  if (text) await userEvent.type(field(), text);
}

/** The find row's status, once it says which match of how many, or why none. */
const status = () => document.querySelector("search output");

describe("finding in the Explorer", () => {
  const scrolled = vi.fn<(this: Element) => void>();
  beforeEach(() => {
    scrolled.mockReset();
    Element.prototype.scrollIntoView = scrolled; // jsdom lays nothing out
  });

  it("shows matches in the folders holding them, marked, revealing the one found once closed", async () => {
    serveDisk();
    await finding("ma");
    await waitFor(() => expect(names()).toEqual(["proj", "main.py"]));
    expect(screen.getByText("ma").tagName).toBe("MARK");
    expect(status()).toHaveTextContent("1 of 1");
    await waitFor(() => expect(document.querySelector("search[data-busy]")).toBeNull()); // settled
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(names()).toEqual(["deep", "proj", "main.py", "old", ".bashrc", "notes.md"]),
    );
    expect(screen.getByText("main.py").closest("[data-current]")).not.toBeNull();
    expect(scrolled.mock.contexts.at(-1)).toHaveTextContent("main.py");
  });

  it("steps through matches in the tree's order, opening the folder stepped into", async () => {
    serveDisk();
    await finding("m");
    await waitFor(() => expect(status()).toHaveTextContent("1 of 2"));
    expect(document.querySelector("[data-current]")).toHaveTextContent("main.py");
    await userEvent.click(screen.getByRole("button", { name: "Close all folders" }));
    expect(names()).toEqual(["proj", "notes.md"]); // the search's folders folded
    const next = screen.getByRole("button", { name: "Next match" });
    await userEvent.click(next);
    await waitFor(() => expect(status()).toHaveTextContent("2 of 2"));
    expect(document.querySelector("[data-current]")).toHaveTextContent("notes.md");
    await userEvent.click(next); // round to the first, its folder opened again
    await waitFor(() => expect(names()).toEqual(["proj", "main.py", "notes.md"]));
  });

  it("starts a search typed anew with its folders open, as folded for the one before", async () => {
    serveDisk();
    await finding("m");
    await waitFor(() => expect(names()).toEqual(["proj", "main.py", "notes.md"]));
    await userEvent.click(screen.getByRole("button", { name: "Close all folders" }));
    expect(names()).toEqual(["proj", "notes.md"]);
    await userEvent.type(field(), "a");
    await waitFor(() => expect(names()).toEqual(["proj", "main.py"]));
  });

  it("matches paths where what is typed has a `/`, and folders, opening to all they hold", async () => {
    serveDisk();
    await finding("proj/ma");
    await waitFor(() => expect(names()).toEqual(["proj", "main.py"]));
    await userEvent.clear(field());
    await userEvent.type(field(), "proj");
    await waitFor(() => expect(names()).toEqual(["proj"]));
    await userEvent.click(screen.getByText("proj"));
    await waitFor(() => expect(names()).toEqual(["proj", "main.py", "old"]));
  });

  it("leaves hidden files out while they are, and folders unjoined", async () => {
    const requests = serveDisk();
    await finding("bash");
    await waitFor(() => expect(names()).toEqual([".bashrc"]));
    await userEvent.click(screen.getByRole("button", { name: "Hidden files" }));
    await waitFor(() => expect(screen.getByText("No files or folders found.")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Hidden files" })); // as it was
    await userEvent.clear(field());
    await userEvent.type(field(), "x");
    await waitFor(() => expect(names()).toEqual(["deep", "inner", "x.txt"])); // not joined
    const listed = requests
      .filter((request) => request.url.includes("/api/files/paths"))
      .map((request) => new URL(request.url).searchParams.get("hidden"));
    expect(listed).toEqual(["true", "false"]); // the first answer kept for showing them again
  });

  it("searches another Directory shown in its place", async () => {
    serveDisk();
    await finding("x", { path: "/home/me/proj" });
    await waitFor(() => expect(screen.getByText("No files or folders found.")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "~" }));
    await waitFor(() => expect(names()).toEqual(["deep", "inner", "x.txt"]));
    expect(field()).toHaveValue("x");
  });

  it("reveals what it found only below the Directory it found it in", async () => {
    DISK["/home/me"]?.push(folder("inner"));
    DISK["/home/me/inner"] = [entry("x.txt")]; // as in deep/: the same path below another
    try {
      serveDisk();
      await finding("x", { path: "/home/me/deep" });
      await waitFor(() => expect(names()).toEqual(["inner", "x.txt"]));
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(document.querySelector("[data-current]")).not.toBeNull());
      await userEvent.click(screen.getByRole("button", { name: "~" }));
      await userEvent.click(await screen.findByText("inner"));
      await screen.findByText("x.txt");
      expect(document.querySelector("[data-current]")).toBeNull();
    } finally {
      DISK["/home/me"]?.pop();
      delete DISK["/home/me/inner"];
    }
  });

  it("reveals a folder found among those joined, once closed", async () => {
    serveDisk();
    await finding("inner");
    await waitFor(() => expect(names()).toEqual(["deep", "inner"]));
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(names()[0]).toBe("deep/inner"));
    expect(screen.getByText("deep/inner").closest("[data-current]")).not.toBeNull();
    expect(scrolled.mock.contexts.at(-1)).toHaveTextContent("deep/inner");
  });

  it("finds what git ignores too if asked, saying when nothing is found", async () => {
    const requests = serveDisk();
    await finding("");
    await userEvent.click(
      screen.getByRole("button", { name: "Include git-ignored files and folders" }),
    );
    await userEvent.type(field(), "nothing");
    expect(await screen.findByText("No files or folders found.")).toBeInTheDocument();
    const listed = requests
      .filter((request) => request.url.includes("/api/files/paths"))
      .map((request) => new URL(request.url).searchParams.get("ignored"));
    expect(listed).toEqual(["false", "true"]);
  });

  it("says when what is typed is an invalid expression, the tree as it was", async () => {
    serveDisk();
    await finding("");
    await userEvent.click(screen.getByRole("button", { name: "Use a regular expression" }));
    await userEvent.type(field(), "(");
    await waitFor(() => expect(status()).toHaveTextContent("Invalid regular expression"));
    expect(names()).toEqual(["deep", "proj", ".bashrc", "notes.md"]); // all, unfound
  });

  it("says when it may not list the Directory", async () => {
    serveDisk({ refused: true });
    await finding("ma");
    expect(
      await screen.findByText("Could not find: not allowed to list /home/me"),
    ).toBeInTheDocument();
  });
});
