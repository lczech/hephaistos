import { render } from "@testing-library/react";
import type { CSSProperties } from "react";
import { describe, expect, it } from "vitest";
import { GraphTips } from "./Graph";
import styles from "./Graph.module.css";
import { Layout, type NodeKind } from "./lanes";

// A graph's band as browsers draw it, while the row below comes in under it.

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
    // The row coming in is drawn from its top, its line from above the tip's node too.
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
    // Over the row coming in, below the tip's node.
    const children = [...rail.children];
    expect(children.indexOf(cap as HTMLElement)).toBeGreaterThan(children.indexOf(next as Element));
    expect(children.indexOf(cap as HTMLElement)).toBeLessThan(children.indexOf(node as Element));
  });

  it("covers nothing while no row comes in, nor above a tip pushed out", () => {
    expect(band({ by: 0 }, null).caps).toHaveLength(0);
    expect(band({ by: -12, leaving: true }, 10).caps).toHaveLength(0);
  });
});
