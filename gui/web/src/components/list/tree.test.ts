import { describe, expect, it } from "vitest";
import { inOrder, loadedRows, note, noteId } from "./tree";

describe("rows asked for once opened", () => {
  const rows = (items: string[]) => items.map((item) => ({ type: "item", id: item }));
  const texts = { more: (more: number, listed: number) => `${more} more than ${listed}` };

  it("say they are asked for, or why they cannot be", () => {
    expect(loadedRows("a", undefined, rows, texts)).toEqual([
      note(noteId("a", "loading"), "Loading…"),
    ]);
    expect(loadedRows("a", undefined, rows, { ...texts, loading: "Loading files…" })).toEqual([
      note(noteId("a", "loading"), "Loading files…"),
    ]);
    expect(loadedRows("a", { error: "gone" }, rows, texts)).toEqual([
      note(noteId("a", "error"), "Could not load: gone", true),
    ]);
  });

  it("show their items, then how many more there are than listed", () => {
    expect(loadedRows("a", { items: ["x"], count: 1 }, rows, texts)).toEqual([
      { type: "item", id: "x" },
    ]);
    expect(loadedRows("a", { items: ["x"], count: 3 }, rows, texts)).toEqual([
      { type: "item", id: "x" },
      note(noteId("a", "more"), "2 more than 1"),
    ]);
  });

  it("say so apart from any row, whatever its name", () => {
    const shown = loadedRows("", { items: [":more", "x"], count: 3 }, rows, texts);
    expect(new Set(shown.map(({ id }) => id)).size).toBe(3);
  });
});

describe("rows beside each other", () => {
  type Row = { name: string; size?: number; folder?: boolean };
  const order = {
    rank: (row: Row) => (row.folder ? 0 : 1),
    values: { name: (row: Row) => row.name, size: (row: Row) => row.size },
    fallback: "name",
  };
  const rows: Row[] = [
    { name: "b", size: 1 },
    { name: "d", folder: true },
    { name: "a", size: 1 },
    { name: "c" },
    { name: "e", size: 5 },
  ];
  const names = (sorted: Row[]) => sorted.map((row) => row.name);

  it("come by their rank first, either way", () => {
    expect(names(inOrder(rows, [], order))).toEqual(["d", "a", "b", "c", "e"]);
    expect(names(inOrder(rows, [{ id: "name", desc: true }], order))).toEqual([
      "d",
      "e",
      "c",
      "b",
      "a",
    ]);
  });

  it("put those without a value last either way, and ties by the fallback", () => {
    expect(names(inOrder(rows, [{ id: "size", desc: false }], order))).toEqual([
      "d",
      "a",
      "b",
      "e",
      "c",
    ]);
    expect(names(inOrder(rows, [{ id: "size", desc: true }], order))).toEqual([
      "d",
      "e",
      "a",
      "b",
      "c",
    ]);
  });
});
