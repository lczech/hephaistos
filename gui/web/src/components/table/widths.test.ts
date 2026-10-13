import { describe, expect, it } from "vitest";
import { columnWidths } from "./widths";

describe("column widths", () => {
  it("start from what this browser kept, if readable", () => {
    localStorage.setItem("hephaistos.columns.kept", '{"kind": 90, "subject": "wide"}');
    localStorage.setItem("hephaistos.columns.broken", "not json");
    expect(columnWidths("kept").get()).toEqual({ kind: 90 });
    expect(columnWidths("broken").get()).toEqual({});
  });

  it("are one per kind of View, kept as they change", () => {
    const widths = columnWidths("changed");
    expect(columnWidths("changed")).toBe(widths);
    widths.set({ kind: 80 });
    expect(localStorage.getItem("hephaistos.columns.changed")).toBe('{"kind":80}');
  });
});
