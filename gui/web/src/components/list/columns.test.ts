import { describe, expect, it } from "vitest";
import { arrangedOrder, columnsOrdered, movable, movedPast } from "./columns";

const columns = [
  { id: "square" },
  { accessorKey: "name", header: "name" },
  { id: "links" },
  { id: "kind", header: "kind" },
  { id: "time", header: "time" },
];

describe("columns in order", () => {
  it("are in their first order until moved, the fixed ones always in their places", () => {
    expect(columnsOrdered(columns, [])).toEqual(["square", "name", "links", "kind", "time"]);
    expect(columnsOrdered(columns, ["time", "kind", "name"])).toEqual([
      "square",
      "time",
      "links",
      "kind",
      "name",
    ]);
  });

  it("keep those not moved yet in their places, and forget those gone", () => {
    expect(columnsOrdered(columns, ["time", "gone", "name"])).toEqual([
      "square",
      "time",
      "links",
      "kind",
      "name",
    ]);
  });
});

describe("a column moved", () => {
  const shown = new Set(["name", "time"]);

  it("goes past the next column shown", () => {
    expect(movedPast(["name", "kind", "time"], "time", -1, shown)).toEqual([
      "time",
      "name",
      "kind",
    ]);
    expect(movedPast(["name", "kind", "time"], "name", 1, shown)).toEqual(["kind", "time", "name"]);
  });

  it("goes nowhere where none shows", () => {
    expect(movedPast(["name", "kind", "time"], "name", -1, shown)).toBeUndefined();
    expect(movedPast(["name", "kind", "time"], "time", 1, shown)).toBeUndefined();
  });
});

describe("a column that stays", () => {
  const withGraph = [
    { id: "square" },
    { id: "graph", header: "graph", meta: { stays: true } },
    { accessorKey: "name", header: "name" },
    { id: "kind", header: "kind" },
  ];

  it("keeps its place however the others move, yet is listed to show or hide", () => {
    expect(movable(withGraph[1] ?? {})).toBe(false);
    expect(movable(withGraph[2] ?? {})).toBe(true);
    expect(movable(withGraph[0] ?? {})).toBe(false);
    expect(columnsOrdered(withGraph, ["kind", "graph", "name"])).toEqual([
      "square",
      "graph",
      "kind",
      "name",
    ]);
    expect(arrangedOrder(withGraph, ["kind", "name"])).toEqual(["graph", "kind", "name"]);
  });

  it("is passed over by the others moving, as if not shown", () => {
    const moving = new Set(["name", "kind"]);
    expect(movedPast(["graph", "name", "kind"], "name", -1, moving)).toBeUndefined();
    expect(movedPast(["graph", "name", "kind"], "kind", -1, moving)).toEqual([
      "graph",
      "kind",
      "name",
    ]);
  });
});
