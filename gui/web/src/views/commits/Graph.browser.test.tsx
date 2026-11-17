import { render } from "@testing-library/react";
import type { CSSProperties } from "react";
import { describe, expect, it } from "vitest";
import { GraphCell, GraphTips } from "./Graph";
import styles from "./Graph.module.css";
import { Layout, type NodeKind } from "./lanes";

// The band of a graph as browsers draw it, while the row below comes in under it.

const BACKGROUND = "rgb(1, 2, 3)";

/** c, the tip at the top, then b and a in its line; b comes in `at` down the band. */
function band(tip: { by: number; leaving?: boolean }, at: number | null) {
  const layout = new Layout({});
  for (const [hash, parents] of [
    ["c", ["b"]],
    ["b", ["a"]],
    ["a", []],
  ] as const) {
    layout.add({ hash, parents: [...parents] });
  }
  const vars = {
    "--graph-width": "40px",
    "--graph-node-y": "12px",
    "--background": BACKGROUND,
  } as CSSProperties;
  const { container } = render(
    <div style={{ position: "relative", width: 200, height: 24, ...vars }}>
      <GraphTips
        layout={layout}
        lines={layout.below(0)}
        tips={[{ lane: 0, node: "head" as NodeKind, colour: { kind: "accent" }, ...tip }]}
        {...(at === null ? {} : { next: { row: 1, at } })}
      />
    </div>,
  );
  const rail = container.querySelector('[data-graph="tips"]') as HTMLElement;
  return { rail, caps: [...rail.querySelectorAll(`.${styles.cap}`)] };
}

const box = (element: Element | null | undefined) => {
  if (!element) throw new Error("missing element");
  return element.getBoundingClientRect();
};

describe("a graph's band", () => {
  it("covers a tip's lane above its node while a row comes in, over that row's line", async () => {
    const { rail, caps } = band({ by: 0 }, 2);
    const node = rail.querySelector(":scope > svg[data-node]");
    const next = rail.querySelector(`.${styles.next}`);
    // The row coming in is drawn from its top, its line from above the node of the tip too.
    const own = next?.querySelector("line") as Element;
    expect(box(own).top).toBeLessThan(box(node).top);
    expect(caps).toHaveLength(1);
    const cap = caps[0] as Element;
    const x = box(own).left + box(own).width / 2;
    expect(box(cap).top).toBeLessThanOrEqual(box(rail).top + 0.5);
    expect(box(cap).bottom).toBeGreaterThanOrEqual(box(node).top + box(node).height / 2 - 0.5);
    expect(box(cap).left).toBeLessThanOrEqual(x - 1);
    expect(box(cap).right).toBeGreaterThanOrEqual(x + 1);
    expect(getComputedStyle(cap).backgroundColor).toBe(BACKGROUND);
    // Over the row coming in, below the node of the tip.
    const children = [...rail.children];
    expect(children.indexOf(cap as HTMLElement)).toBeGreaterThan(children.indexOf(next as Element));
    expect(children.indexOf(cap as HTMLElement)).toBeLessThan(children.indexOf(node as Element));
  });

  it("covers nothing while no row comes in, nor above a tip pushed out", () => {
    expect(band({ by: 0 }, null).caps).toHaveLength(0);
    expect(band({ by: -12, leaving: true }, 10).caps).toHaveLength(0);
  });
});

describe("a stretch in a graph", () => {
  /** t and u apart, u's line passing the stretch s of t, in a row `height` high. */
  function stretch(height: number) {
    const layout = new Layout({});
    layout.add({ hash: "t", parents: ["s"] });
    layout.add({ hash: "u", parents: ["b"] });
    layout.add({ hash: "s", parents: ["b"], stretch: true });
    layout.add({ hash: "b", parents: [] });
    const vars = { "--graph-width": "40px", "--graph-node-y": "11.5px" } as CSSProperties;
    const { container } = render(
      <div style={{ position: "relative", width: 200, height, ...vars }}>
        <GraphCell layout={layout} row={2} />
      </div>,
    );
    return container.firstElementChild as HTMLElement;
  }

  it("draws its lane through its row dashed in one piece, without a node, others as they are", () => {
    const row = stretch(24);
    expect(row.querySelector("svg[data-node]")).toBeNull();
    const pieces = [...row.querySelectorAll("svg[data-dashes]")];
    expect(pieces.map((each) => each.getAttribute("data-dashes"))).toEqual(["0"]);
    expect(box(pieces[0]).top).toBeCloseTo(box(row).top, 1);
    expect(box(pieces[0]).bottom).toBeCloseTo(box(row).bottom, 1);
    // Nothing else in its lane; the other passing solid.
    const xs = (selector: string) =>
      [...row.querySelectorAll(selector)].map((each) =>
        Number(each.getAttribute("x1") ?? each.getAttribute("d")?.slice(1).split(" ")[0]),
      );
    expect(xs("svg:not([data-dashes]) :is(line, path)")).not.toContain(6);
    expect(xs("svg:not([data-dashes]) line")).toContain(18);
    expect(row.querySelectorAll("[stroke-dasharray]")).toHaveLength(1);
  });

  it("fits whole dashes, of about the same length, to rows of any height", () => {
    for (const height of [24, 23.5, 37, 61]) {
      const piece = stretch(height).querySelector("svg[data-dashes]");
      const [none, half, dash] = (
        piece?.querySelector("line")?.getAttribute("stroke-dasharray") ?? ""
      )
        .split(" ")
        .map(Number) as [number, number, number];
      expect(none).toBe(0); // starts with half a gap, so that rows meet with a whole one
      const periods = box(piece).height / (2 * half + dash);
      expect(periods).toBeCloseTo(Math.round(periods), 3);
      expect(Math.abs(dash - 2)).toBeLessThan(0.3);
      expect(2 * half).toBeCloseTo(1.5 * dash, 3);
    }
  });
});
