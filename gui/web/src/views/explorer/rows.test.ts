import { describe, expect, it } from "vitest";
import type { Loaded } from "../../components/list/tree";
import { fileEntry } from "../../test/server";
import { asked, below, type Entry, type FileEntry, type Making, rows, shownPaths } from "./rows";

const entry = fileEntry;

const folder = (name: string) => entry(name, { kind: "directory" });

/** A tree on disk, by folder: what each holds. */
const DISK: Record<string, FileEntry[]> = {
  "/r": [entry("b10.txt"), folder("src"), entry("B2.txt"), entry(".env"), folder(".git")],
  "/r/src": [folder("app")],
  "/r/src/app": [entry("main.py"), folder("lib")],
  "/r/src/app/lib": [entry("x.py")],
};

function making(opened: string[], fields: Partial<Making> = {}): Making {
  const loaded = (path: string): Loaded<FileEntry> => {
    const items = DISK[path];
    return items && { items, count: items.length };
  };
  return { loaded, opened: new Set(opened), hidden: true, sorted: [], ...fields };
}

/** Rows as text, a step in for each level: `src/app`. */
function text(found: Entry[], depth = 0): string[] {
  return found.flatMap((row) => [
    `${"  ".repeat(depth)}${row.type === "note" ? `(${row.text})` : row.shown}`,
    ...text(row.subRows, depth + 1),
  ]);
}

describe("the Explorer's rows", () => {
  it("list folders first, then names as people sort them", () => {
    expect(text(rows("/r", making([])))).toEqual([".git", "src", ".env", "B2.txt", "b10.txt"]);
    expect(text(rows("/r", making([], { sorted: [{ id: "name", desc: true }] })))).toEqual([
      "src",
      ".git",
      "b10.txt",
      "B2.txt",
      ".env",
    ]);
  });

  it("leave hidden entries out if asked", () => {
    expect(text(rows("/r", making([], { hidden: false })))).toEqual(["src", "B2.txt", "b10.txt"]);
  });

  it("say which paths they show, each folder of a chain joined", () => {
    const [, src] = rows("/r", making(["src/"]));
    expect(src?.type === "entry" && shownPaths(src)).toEqual(["src", "src/app"]);
    const main = src?.subRows.find((row) => row.type === "entry" && row.shown === "main.py");
    expect(main?.type === "entry" && shownPaths(main)).toEqual(["src/app/main.py"]);
  });

  it("open folders through those holding a single folder, joined", () => {
    expect(text(rows("/r", making(["src/", "src/app/lib/"])))).toEqual([
      ".git",
      "src/app",
      "  lib",
      "    x.py",
      "  main.py",
      ".env",
      "B2.txt",
      "b10.txt",
    ]);
  });

  it("say what is asked for, and what cannot be", () => {
    const loaded = (path: string): Loaded<FileEntry> =>
      path === "/r" ? { items: DISK["/r"] ?? [], count: 7 } : { error: "not allowed to list" };
    expect(text(rows("/r", { ...making([".git/"]), loaded }))).toEqual([
      ".git",
      "  (Could not load: not allowed to list)",
      "src",
      ".env",
      "B2.txt",
      "b10.txt",
      "(2 more not listed, as the setting files.max_entries allows 5)",
    ]);
    expect(text(rows("/r", { ...making([]), loaded: () => undefined }))).toEqual(["(Loading…)"]);
  });

  it("join none through a symlink to a folder, which may lead back above it", () => {
    const loop: Record<string, FileEntry[]> = {
      "/l": [folder("x")],
      "/l/x": [entry("self", { kind: "symlink", to: "directory" })], // self -> .
    };
    const loaded = (path: string): Loaded<FileEntry> => {
      const items = loop[path] ?? loop["/l/x"] ?? [];
      return { items, count: items.length };
    };
    expect(text(rows("/l", { ...making(["x/"]), loaded }))).toEqual(["x", "  self"]);
  });

  it("join none through a folder kept apart, as a Checkout's top", () => {
    const apart = (path: string) => path === "/r/src";
    expect(text(rows("/r", making(["src/"], { apart, hidden: false })))).toEqual([
      "src",
      "  app",
      "B2.txt",
      "b10.txt",
    ]);
  });

  it("tell a folder known to show nothing, open or not, without asking for any", () => {
    const disk: Record<string, FileEntry[]> = {
      "/e": [folder("none"), folder("dots"), folder("sized"), folder("unknown")],
      "/e/none": [],
      "/e/dots": [entry(".env")],
    };
    const known = (path: string): Loaded<FileEntry> => {
      const items = disk[path];
      return items && { items, count: items.length };
    };
    const loaded = (path: string) => (path === "/e" ? known(path) : undefined); // asked for
    const sized = { ...folder("sized"), items: 0 }; // as the size column says
    const shown = rows("/e", {
      ...making(["none/"]),
      loaded: (path) =>
        path === "/e"
          ? { items: [...(disk["/e"] ?? []).slice(0, 2), sized, folder("unknown")], count: 4 }
          : loaded(path),
      known,
      hidden: false,
    });
    const empty = Object.fromEntries(
      shown.flatMap((row) => (row.type === "entry" ? [[row.shown, row.empty]] : [])),
    );
    expect(empty).toEqual({ dots: true, none: true, sized: true, unknown: false });
    expect(shown.find((row) => row.type === "entry" && row.shown === "none")?.subRows).toEqual([]);
    const { loaded: _, ...rest } = making(["none/"]);
    // None asked for to tell; the one open still, so that it tells once it holds something.
    expect(asked("/e", { ...rest, known }, loaded)).toEqual(["/e", "/e/none"]);
  });

  it("ask for the folders shown open, through those joined", () => {
    const { loaded, ...rest } = making(["src/", "src/app/lib/", "gone/"]);
    expect(asked("/r", rest, loaded)).toEqual(["/r", "/r/src", "/r/src/app", "/r/src/app/lib"]);
  });

  it("join paths", () => {
    expect([below("/", "a"), below("/r", "a/"), below("/r/", "a/b")]).toEqual([
      "/a",
      "/r/a",
      "/r/a/b",
    ]);
  });
});
