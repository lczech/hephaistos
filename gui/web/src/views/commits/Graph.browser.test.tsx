/// <reference types="@vitest/browser-playwright" />
// The types of the devtools protocol of Chromium (`cdp`), as Playwright gives it.
import { cleanup, render } from "@testing-library/react";
import type { CSSProperties } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cdp, server } from "vitest/browser";
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

describe("a node's line down to its parent in its lane", () => {
  it("is drawn straight, with crisp edges as the lines passing it, not as a curve", () => {
    const layout = new Layout({});
    layout.add({ hash: "b", parents: ["a"] });
    layout.add({ hash: "a", parents: [] });
    const { container } = render(
      <div style={{ position: "relative", height: 24, "--graph-width": "40px" } as CSSProperties}>
        <GraphCell layout={layout} row={0} />
      </div>,
    );
    const head = container.querySelector(`.${styles.head}`) as Element;
    expect(head.querySelectorAll("path")).toHaveLength(0);
    const lines = [...head.querySelectorAll("line")];
    expect(lines).toHaveLength(1);
    for (const line of lines) expect(getComputedStyle(line).shapeRendering).toBe("crispedges");
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
      evenDashes(piece, 1);
    }
  });
});

describe("a lane dashed at any ratio of device pixels", () => {
  /** u uncommitted on t: its lane dashed from its node, a fraction of a pixel down, in a row
   * `height` high, as in the app. */
  function belowNode(height: number) {
    const layout = new Layout({});
    layout.add({ hash: "u", parents: ["t"], uncommitted: true });
    layout.add({ hash: "t", parents: [] });
    const vars = {
      "--graph-width": "40px",
      "--graph-node-y": "12.15px",
      "--background": "white",
    } as CSSProperties;
    const { container } = render(
      <div style={{ position: "relative", height, background: "white", ...vars }}>
        <GraphCell layout={layout} row={0} />
      </div>,
    );
    return container.firstElementChild as HTMLElement;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("draws dashes and gaps of whole device pixels, the dashes of one length", () => {
    for (const ratio of [1, ZOOMED_IN, 1.25, 1.5, 2, ZOOMED_OUT]) {
      vi.stubGlobal("devicePixelRatio", ratio);
      for (const height of [24.3, 26.3, 61]) {
        const piece = belowNode(height).querySelector("svg[data-dashes]");
        evenDashes(piece, ratio);
      }
    }
  });

  // As Chromium draws them, in a screenshot at a ratio set by its devtools protocol, as zooming sets
  // one; the others have no such protocol.
  it.runIf(server.browser === "chromium")(
    "shows the dashes below a node of one length at fractional ratios",
    async () => {
      const session = cdp();
      try {
        for (const ratio of [ZOOMED_IN, 1.25, 1.5]) {
          await session.send("Emulation.setDeviceMetricsOverride", {
            width: window.innerWidth,
            height: window.innerHeight,
            deviceScaleFactor: ratio,
            mobile: false,
          });
          // Drawn anew at the ratio: for a ratio set so, Chromium tells no media query of the change.
          const row = belowNode(61);
          await new Promise((done) => requestAnimationFrame(() => setTimeout(done, 50)));
          const runs = await inkDown(session, row.querySelector("svg[data-dashes]"), 6);
          const dashes = runs.slice(1, -1).filter((run) => run.ink);
          expect(dashes.length).toBeGreaterThan(5);
          expect(new Set(dashes.map((run) => run.length))).toEqual(
            new Set([Math.round(2 * ratio)]),
          );
          cleanup();
        }
      } finally {
        await session.send("Emulation.clearDeviceMetricsOverride", {});
      }
    },
  );
});

// The ratios of the Desktop zoomed a step in and out (its `ZOOM_STEP`, of a level, 1.2 each).
const ZOOMED_IN = 1.2 ** 0.5;
const ZOOMED_OUT = 1.2 ** -0.5;

/**
 * Checks the dash array of a lane dashed, in device pixels: each a whole number of them; the
 * dashes of about 2 CSS px, all of one length; the gaps between them within a pixel of each other;
 * and half of one about at each end, so that pieces meet with a gap as any other.
 */
function evenDashes(piece: Element | null, ratio: number) {
  const array = (piece?.querySelector("line")?.getAttribute("stroke-dasharray") ?? "")
    .split(" ")
    .map((each) => Number(each) * ratio);
  for (const each of array) expect(each).toBeCloseTo(Math.round(each), 6);
  // 0, the gap above, then each dash and the gap after it, the last to beyond the end.
  const [none, above, ...rest] = array.map(Math.round);
  expect(none).toBe(0);
  const dashes = rest.filter((_, i) => i % 2 === 0);
  const gaps = rest.slice(1, -1).filter((_, i) => i % 2 === 0);
  expect(new Set(dashes)).toEqual(new Set([Math.round(2 * ratio)]));
  if (gaps.length === 0) return;
  expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
  const end = rest.slice(0, -1).reduce((sum, each) => sum + each, above ?? 0);
  const below = box(piece).height * ratio - end;
  const gap = gaps.reduce((sum, each) => sum + each, 0) / gaps.length;
  expect(Math.abs((above ?? 0) + below - gap)).toBeLessThanOrEqual(1.5);
}

/** The runs of ink and of none down the middle of the lane dashed in `piece`, in device pixels
 * of a screenshot, from `below` CSS px under its top. */
async function inkDown(session: ReturnType<typeof cdp>, piece: Element | null, below: number) {
  const ratio = devicePixelRatio;
  const line = piece?.querySelector("line") as SVGLineElement;
  const at = box(piece);
  const { data } = (await session.send("Page.captureScreenshot", { format: "png" })) as {
    data: string;
  };
  const png = Uint8Array.from(atob(data), (each) => each.charCodeAt(0));
  const image = await createImageBitmap(new Blob([png], { type: "image/png" }));
  const canvas = new OffscreenCanvas(image.width, image.height);
  const context = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
  context.drawImage(image, 0, 0);
  // The tests run in a frame of the page the screenshot is of.
  const frame = (window.frameElement as HTMLElement).getBoundingClientRect();
  const scale = frame.width / window.innerWidth;
  const column = Math.floor((frame.left + (at.left + line.x1.baseVal.value) * scale) * ratio);
  const top = Math.round((frame.top + (at.top + below) * scale) * ratio);
  const bottom = Math.round((frame.top + at.bottom * scale) * ratio);
  const pixels = context.getImageData(column, top, 1, bottom - top).data;
  const runs: { ink: boolean; length: number }[] = [];
  for (let i = 0; i < pixels.length; i += 4) {
    const ink = (pixels[i] ?? 255) + (pixels[i + 1] ?? 255) + (pixels[i + 2] ?? 255) < 3 * 200;
    const last = runs.at(-1);
    if (last?.ink === ink) last.length += 1;
    else runs.push({ ink, length: 1 });
  }
  return runs;
}
