import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { columnWidths, useListLayout } from "./kept";

describe("column widths", () => {
  it("start from what this browser kept, if readable", () => {
    localStorage.setItem("hephaistos.lists.kept.widths", '{"kind": 90, "subject": "wide"}');
    localStorage.setItem("hephaistos.lists.broken.widths", "not json");
    expect(columnWidths("kept").get()).toEqual({ kind: 90 });
    expect(columnWidths("broken").get()).toEqual({});
  });

  it("are one per kind of View, kept as they change", () => {
    const widths = columnWidths("changed");
    expect(columnWidths("changed")).toBe(widths);
    widths.set({ kind: 80 });
    expect(localStorage.getItem("hephaistos.lists.changed.widths")).toBe('{"kind":80}');
  });
});

describe("a list's layout", () => {
  afterEach(() => vi.unstubAllGlobals());

  const pointer = (coarse: boolean) =>
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: coarse && query === "(pointer: coarse)",
    }));

  it("starts as the device does: in columns with a mouse, in two lines with a finger", () => {
    pointer(false);
    expect(renderHook(() => useListLayout("mouse")).result.current[0]).toBe("columns");
    pointer(true);
    expect(renderHook(() => useListLayout("finger")).result.current[0]).toBe("lines");
  });

  it("is kept once chosen, per kind of View", () => {
    pointer(true);
    const { result } = renderHook(() => useListLayout("chosen"));
    act(() => result.current[1]("columns"));
    expect(result.current[0]).toBe("columns");
    expect(localStorage.getItem("hephaistos.lists.chosen.layout")).toBe('"columns"');
    expect(renderHook(() => useListLayout("other")).result.current[0]).toBe("lines");
  });
});
