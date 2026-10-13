import type { SerializedDockview } from "dockview-react";
import { describe, expect, it } from "vitest";
import { savedLayout, saveLayout } from "./saved";

const dock = { grid: {}, panels: {} } as unknown as SerializedDockview;

describe("the saved Layout", () => {
  it("is none at first", () => {
    expect(savedLayout()).toBeNull();
  });

  it("reads back", () => {
    saveLayout(dock);
    expect(savedLayout()).toEqual(dock);
  });

  it("is dropped in another format, or unreadable", () => {
    for (const saved of ['{"format": 1, "dock": {}}', '{"format": 2}', "not json"]) {
      localStorage.setItem("hephaistos.layout", saved);
      expect(savedLayout()).toBeNull();
    }
  });
});
