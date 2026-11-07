import { describe, expect, it } from "vitest";
import { findMatches, findPattern } from "../../components/find/pattern";
import { type FileEntry, rows } from "./rows";
import {
  foldersOf,
  foundPaths,
  inTreeOrder,
  listedOf,
  MAX_SHOWN,
  searchLines,
  searchNote,
  searchOf,
} from "./search";

const PATHS = ["README", "src/", "src/app/", "src/app/main.py", "src/app/readme.md", "to-src"];

/** What typing `text` finds in PATHS, as the find row matches it. */
function finding(text: string, paths: readonly string[] = PATHS) {
  const byPath = text.includes("/");
  const pattern = findPattern({ text, matchCase: false, wholeWord: false, regex: false });
  if ("error" in pattern) throw new Error(pattern.error);
  const { matches, more } = findMatches(searchLines(paths, byPath), pattern, 10_000);
  return foundPaths(paths, matches, { more, byPath });
}

describe("finding files by name", () => {
  it("matches names, or paths where what is typed has a `/`", () => {
    expect(searchLines(PATHS, false)).toEqual([
      "README",
      "src",
      "app",
      "main.py",
      "readme.md",
      "to-src",
    ]);
    expect(finding("readme").paths).toEqual(["README", "src/app/readme.md"]);
    expect(finding("src").paths).toEqual(["src/", "to-src"]); // not all in src/
    expect(finding("app/m").paths).toEqual(["src/app/main.py"]);
  });

  it("marks matches in names, a path's only as far as they are in its name", () => {
    expect(finding("me").marks.get("src/app/readme.md")).toEqual([[4, 6]]);
    expect(finding("app/ma").marks.get("src/app/main.py")).toEqual([[0, 2]]);
    expect(finding("src/").marks.size).toBe(0); // in the folders holding them only
  });

  it("shows the first matches, counting all", () => {
    const many = Array.from({ length: MAX_SHOWN + 5 }, (_, at) => `f${at}.txt`);
    const found = finding("f", many);
    expect([found.paths.length, found.total]).toEqual([MAX_SHOWN, MAX_SHOWN + 5]);
    expect(searchNote(found, undefined)?.text).toBe("first 1,000 shown");
  });

  it("says where listing stopped", () => {
    const listed = { path: "/r", paths: [], stopped: "time" as const, limit: 10 };
    expect(searchNote(finding("x"), listed)).toEqual({
      text: "stopped after 10 s",
      title:
        "Listing stopped after 10 s, as the setting files.search_seconds allows: find in a folder further in",
    });
    expect(searchNote(finding("x"), undefined)).toBeUndefined();
  });

  it("shows the matches in the folders holding them, listed as the paths name them", () => {
    expect(foldersOf("src/app/main.py")).toEqual(["src/", "src/app/"]);
    const search = searchOf(["src/app/main.py", "README"]);
    expect([...search.shown]).toEqual(["src/app/main.py", "README", "src", "src/app"]);
    expect([...search.within]).toEqual(["", "src/", "src/app/"]);
    const listed = listedOf("/r", ["src/app/main.py", "README"], search.folders);
    expect(listed.get("/r")?.items.map(({ name, kind }) => [name, kind])).toEqual([
      ["src", "directory"],
      ["README", "file"],
    ]);
    expect(listed.get("/r/src/app")?.items.map(({ name }) => name)).toEqual(["main.py"]);
  });

  it("steps through matches in the tree's order, folders first", () => {
    const found = ["README", "src/app/main.py", "src/app/"];
    const search = searchOf(found);
    const listed = listedOf("/r", found, search.folders);
    const tree = rows("/r", {
      loaded: (path) => listed.get(path) as { items: FileEntry[]; count: number },
      opened: search.folders,
      hidden: true,
      sorted: [],
      search,
    });
    expect(inTreeOrder(tree, new Set(["README", "src/app/main.py", "src/app"]))).toEqual([
      "src/app",
      "src/app/main.py",
      "README",
    ]);
  });
});
