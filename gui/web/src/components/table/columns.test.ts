import { describe, expect, it } from "vitest";
import { columnsOrdered, movedPast } from "./columns";

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
