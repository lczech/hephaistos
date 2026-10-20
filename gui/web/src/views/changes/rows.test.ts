import { describe, expect, it } from "vitest";
import {
  type Change,
  entries,
  entryId,
  type Group,
  kindCounts,
  otherText,
  pathParts,
  sizeText,
  totalsText,
} from "./rows";

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

function group(name: Group["name"], changes: Change[], count = changes.length): Group {
  return { name, from: "index", to: "working-tree", changes, count };
}

describe("a change's texts", () => {
  it("parts a path into its folder and name; a folder's name ends in /", () => {
    expect(pathParts("src/views/rows.ts")).toEqual(["src/views/", "rows.ts"]);
    expect(pathParts("README.md")).toEqual(["", "README.md"]);
    expect(pathParts("new/")).toEqual(["", "new/"]);
    expect(pathParts("src/new/")).toEqual(["src/", "new/"]);
  });

  it("gives sizes in bytes, kB, MB", () => {
    expect([512, 3400, 12_345, 1_200_000, 5e9].map(sizeText)).toEqual([
      "512 B",
      "3.4 kB",
      "12 kB",
      "1.2 MB",
      "5.0 GB",
    ]);
  });

  it("says what changed if not lines", () => {
    const binary = { added: null, removed: null, binary: true };
    expect(otherText(change("a.png", { ...binary, size: 1400, old_size: 1200 }))).toBe(
      "binary, 1.2 kB → 1.4 kB",
    );
    expect(otherText(change("a.png", { ...binary, old_size: 700, status: "D" }))).toBe(
      "binary, 700 B",
    );
    expect(otherText(change("big.csv", { added: null, removed: null, size: 12e6 }))).toBe(
      "12 MB, not counted",
    );
    expect(otherText(change("new/", { added: null, removed: null, files: 1, size: 3 }))).toBe(
      "1 file, 3 B",
    );
    expect(
      otherText(
        change("venv/", { added: null, removed: null, files: 10_000, more_files: true, size: 2e6 }),
      ),
    ).toBe("10,000+ files, 2.0 MB");
    expect(otherText(change("a.py"))).toBeUndefined();
  });

  it("totals the files listed, a file in two groups once, and how many more there are", () => {
    const staged = group("staged", [change("a", { added: 2 }), change("b")]);
    const unstaged = group("unstaged", [change("a", { added: 1_500, removed: 3 })]);
    expect(totalsText([staged, unstaged])).toBe("2 files, +1,503 −3");
    expect(totalsText([staged, { ...unstaged, count: 1_650 }])).toBe(
      "2 files, +1,503 −3 (1,649 more not listed)",
    );
  });
});

describe("the rows", () => {
  const nothingWithin = () => undefined;

  it("keep git's groups in order, sorting within them, unknown sizes last", () => {
    const rows = entries(
      [
        group("staged", [change("b", { added: 5 }), change("a", { added: 9 })]),
        group("untracked", [
          change("c", { added: null, removed: null, binary: true }),
          change("d", { added: 2 }),
        ]),
      ],
      nothingWithin,
      [{ id: "lines", desc: true }],
    );
    expect(rows.map((row) => [entryId(row), row.subRows.map(entryId)])).toEqual([
      ["staged", ["staged:a", "staged:b"]],
      ["untracked", ["untracked:d", "untracked:c"]],
    ]);
  });

  it("hold a directory's changes, directories and new folders before files", () => {
    const [row] = entries(
      [
        group("untracked", [
          change("z.txt", { status: "?" }),
          change("src/b.py", { status: "?", added: 7 }),
          change("new/", { status: "?", added: null, removed: null, files: 1 }),
          change("src/a.py", { status: "?" }),
          change("doc/x.md", { status: "?" }),
        ]),
      ],
      nothingWithin,
      [],
    );
    expect(row?.subRows.map(entryId)).toEqual([
      "untracked/doc/",
      "untracked/src/",
      "untracked:new/",
      "untracked:z.txt",
    ]);
    expect(row?.subRows[1]?.subRows.map(entryId)).toEqual([
      "untracked:src/a.py",
      "untracked:src/b.py",
    ]);
    expect(row?.subRows[1]).toMatchObject({ type: "directory", path: "src/" });
    expect(row?.subRows[1]?.subRows[0]).toMatchObject({ base: "src/" });
  });

  it("count each kind of change", () => {
    const changes = [
      change("a", { status: "D" }),
      change("b"),
      change("c", { status: "T" }),
      change("new/", { status: "?" }),
    ];
    expect(kindCounts(changes)).toEqual([
      ["modified", 2],
      ["new folder", 1],
      ["deleted", 1],
    ]);
  });

  it("say how many more there are than listed, and that a setting stops them", () => {
    const [row] = entries([group("unstaged", [change("a")], 1001)], nothingWithin, []);
    expect(row?.subRows.at(-1)).toMatchObject({
      type: "note",
      text: "1,000 more not listed, as the setting gui.diff.max_files allows 1 per list",
    });
  });

  it("hold a folder's files once asked, and say so meanwhile", () => {
    const folder = change("new/", { status: "?", added: null, removed: null, files: 2 });
    const untracked = group("untracked", [folder]);
    const asking = entries([untracked], nothingWithin, []);
    expect(asking[0]?.subRows[0]?.subRows).toMatchObject([
      { type: "note", text: "Loading files…" },
    ]);
    const found = { changes: [change("new/b"), change("new/a")], count: 2 };
    const listed = entries([untracked], () => found, []);
    expect(listed[0]?.subRows[0]?.subRows.map(entryId)).toEqual([
      "untracked:new/a",
      "untracked:new/b",
    ]);
  });
});
