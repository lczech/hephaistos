import { describe, expect, it, vi } from "vitest";
import { clone, fileEntry, repository, worktree } from "../../test/server";
import { knownCheckouts, placeOf, rowMenu, showsFile } from "./actions";
import type { Entry } from "./rows";

type Shown = Extract<Entry, { type: "entry" }>;

function row(path: string, fields: Partial<Shown> = {}, entry = {}): Shown {
  const name = path.split("/").at(-1) ?? "";
  return {
    type: "entry",
    id: name,
    path,
    parent: path.slice(0, path.lastIndexOf("/")),
    shown: name,
    entry: fileEntry(name, entry),
    folder: false,
    subRows: [],
    ...fields,
  };
}

// A Clone registered by a path through a symlink, `/home/me/link`, resolved `/data/proj`.
const known = knownCheckouts([
  repository("proj", [
    clone("proj", {
      path: "/home/me/link",
      resolved_path: "/data/proj",
      worktrees: [{ ...worktree("proj", "side"), path: "/data/side" }],
    }),
  ]),
]);

describe("where an entry is in its Checkout", () => {
  it("is found by the path it was reached by, as registered or resolved", () => {
    expect(placeOf(row("/home/me/link/src/a.py"), "/data/proj", known)).toEqual({
      checkout: { clone: "clone-proj" },
      relative: "src/a.py",
    });
    expect(placeOf(row("/data/proj/src/a.py"), "/data/proj", known)?.relative).toBe("src/a.py");
    expect(placeOf(row("/data/side/b.py"), "/data/side", known)).toEqual({
      checkout: { worktree: "wt-proj-side" },
      relative: "b.py",
    });
  });

  it("is the top of a Checkout for its own folder, also in a folder that is no working tree", () => {
    const top = row("/home/me/link", { folder: true });
    expect(placeOf(top, undefined, known)).toEqual({
      checkout: { clone: "clone-proj" },
      relative: "",
    });
    const [open, goInto] = [vi.fn(), vi.fn()];
    const menu = rowMenu(top, placeOf(top, undefined, known), open, goInto);
    expect(menu.groups.map((group) => group.map(({ label }) => label))).toEqual([
      ["Go into folder"],
      ["History"],
      ["Copy absolute path"], // no path in the Checkout to copy
    ]);
    menu.groups[0]?.[0]?.onAction();
    expect(goInto).toHaveBeenCalledWith("/home/me/link");
    menu.groups[1]?.[0]?.onAction();
    expect(open).toHaveBeenCalledWith(
      { kind: "history", params: { clone: "clone-proj" } }, // all its files
      { preview: true },
    );
  });

  it("is nowhere outside a working tree or a registered Checkout", () => {
    expect(placeOf(row("/tmp/a.py"), undefined, known)).toBeUndefined();
    expect(placeOf(row("/srv/other/a.py"), "/srv/other", known)).toBeUndefined();
  });
});

describe("a row's menu", () => {
  const place = { checkout: { clone: "clone-proj" }, relative: "src/a.py" };
  const labels = (menu: ReturnType<typeof rowMenu>) =>
    menu.groups.map((group) => group.map(({ label }) => label));

  it("offers a changed file's Diff and History, and copying its path both ways", () => {
    const open = vi.fn();
    const menu = rowMenu(row("/data/proj/src/a.py", {}, { status: "M" }), place, open, vi.fn());
    expect(labels(menu)).toEqual([
      ["Diff", "History"],
      ["Copy absolute path", "Copy relative path"],
    ]);
    menu.groups[0]?.[0]?.onAction();
    expect(open).toHaveBeenCalledWith(
      {
        kind: "diff",
        params: { clone: "clone-proj", from: "HEAD", to: "working-tree", path: "src/a.py" },
      },
      { preview: true },
    );
  });

  it("offers no Diff without changes, nor Views or a relative path outside a Checkout", () => {
    expect(labels(rowMenu(row("/data/proj/src/a.py"), place, vi.fn(), vi.fn()))).toEqual([
      ["History"],
      ["Copy absolute path", "Copy relative path"],
    ]);
    expect(
      labels(rowMenu(row("/tmp/a.py", {}, { status: "M" }), undefined, vi.fn(), vi.fn())),
    ).toEqual([["Copy absolute path"]]);
  });

  it("offers no History for what git ignores or does not track, nor for `.git`", () => {
    const folder = { folder: true };
    const cases: [string, object][] = [
      ["/data/proj/build", { ignored: true }],
      ["/data/proj/new", { status: "?", index: "?", worktree: "?" }],
      ["/data/proj/.git", {}], // git's own, which it never reports
    ];
    for (const [path, git] of cases) {
      const menu = rowMenu(row(path, folder, git), place, vi.fn(), vi.fn());
      expect(labels(menu)).toEqual([
        ["Go into folder"],
        ["Copy absolute path", "Copy relative path"],
      ]);
    }
  });
});

describe("a View shown about a file", () => {
  const place = { checkout: { clone: "clone-proj" }, relative: "src/a.py" };
  const diff = (params: Record<string, string>) =>
    showsFile(
      { kind: "diff", params: { clone: "clone-proj", path: "src/a.py", ...params } },
      place,
    );

  it("is its Diff comparing the working tree with anything, either way", () => {
    expect(diff({ from: "HEAD", to: "working-tree" })).toBe(true);
    expect(diff({ from: "index", to: "working-tree" })).toBe(true);
    expect(diff({ from: "working-tree", to: "main" })).toBe(true);
  });

  it("is not a commit's or the staged changes, nor another file's or Checkout's", () => {
    expect(diff({ from: "HEAD", to: "index" })).toBe(false);
    expect(diff({ commit: "abc1234" })).toBe(false);
    expect(diff({ from: "HEAD", to: "working-tree", path: "src/b.py" })).toBe(false);
    expect(diff({ from: "HEAD", to: "working-tree", clone: "clone-other" })).toBe(false);
    expect(
      showsFile({ kind: "history", params: { clone: "clone-proj", path: "src/a.py" } }, place),
    ).toBe(false);
    expect(
      showsFile(
        {
          kind: "diff",
          params: { clone: "clone-proj", from: "HEAD", to: "working-tree", path: "src/a.py" },
        },
        undefined,
      ),
    ).toBe(false);
  });
});
