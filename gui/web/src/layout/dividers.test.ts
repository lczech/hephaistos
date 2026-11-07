import { describe, expect, it } from "vitest";
import { splitLocation } from "./dividers";

/** An element of these classes, holding these. */
function element(classes: string, ...children: Element[]): Element {
  const made = document.createElement("div");
  made.className = classes;
  made.append(...children);
  return made;
}

/** A split's node as dockview's grid nests it: its splitview's container, a view per part. */
const split = (...parts: Element[]) =>
  element(
    "dv-branch-node",
    element(
      "dv-split-view-container dv-horizontal",
      element("dv-sash-container"),
      element("dv-view-container", ...parts.map((part) => element("dv-view", part))),
    ),
  );

describe("a split's location, from its elements", () => {
  it("is its parts' indexes down from the top, as dockview's are", () => {
    const inner = split(element("dv-groupview"), element("dv-groupview"));
    const middle = split(element("dv-groupview"), inner);
    const top = split(middle, element("dv-groupview"));
    element("dv-grid-view", top);
    expect(splitLocation(top)).toEqual([]);
    expect(splitLocation(middle)).toEqual([0]);
    expect(splitLocation(inner)).toEqual([0, 1]);
  });

  it("is none for elements nested otherwise, e.g. outside the grid", () => {
    expect(splitLocation(split())).toBeUndefined();
    expect(splitLocation(element("dv-branch-node"))).toBeUndefined();
    const stray = split(element("dv-groupview"));
    element("other", stray);
    expect(splitLocation(stray)).toBeUndefined();
  });
});
