import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { QUERY_DEFAULTS } from "../api/queries";
import { saveGrid } from "../test/layout";
import { daemon, json, serve } from "../test/server";
import { splitLocation } from "./dividers";
import { Workbench } from "./Workbench";

// dividers.ts reads dockview's elements; these keep watch that they are still as it expects.

const WIDTH = 1200;
const HEIGHT = 800;

async function renderWorkbench(first: string) {
  render(
    <QueryClientProvider client={new QueryClient(QUERY_DEFAULTS)}>
      <div style={{ width: WIDTH, height: HEIGHT }}>
        <Workbench />
      </div>
    </QueryClientProvider>,
  );
  await screen.findByRole("tab", { name: first });
}

/** The Groups' sizes on screen, in reading order, rounded: [width, height]. */
const sizes = () =>
  [...document.querySelectorAll(".dv-groupview")].map((group) => {
    const { width, height } = group.getBoundingClientRect();
    return [Math.round(width), Math.round(height)] as const;
  });
const widths = () => sizes().map(([width]) => width);
const heights = () => sizes().map(([, height]) => height);

/** Whether the sizes are even, as near as whole pixels and dividers allow. */
const even = (values: number[]) => Math.max(...values) - Math.min(...values) <= 2;

/** The dividers of the split whose splitview's container this is, in order, shown or not. */
const dividersOf = (container: Element) => [
  ...(container.querySelector(":scope > .dv-sash-container")?.children ?? []),
];

/** The top split's container, and those within it, side by side or one above another. */
const top = () =>
  document.querySelector(".dv-grid-view > .dv-branch-node > .dv-split-view-container");
const within = (way: "horizontal" | "vertical") =>
  document.querySelector(`.dv-view > .dv-branch-node > .dv-split-view-container.dv-${way}`);

beforeEach(() => {
  serve({ "GET /api/daemon": () => json(daemon()) });
});

describe("dockview's dividers, as dividers.ts reads them", () => {
  it("are elements of the class it names, in splits it can locate", async () => {
    saveGrid([{ tabs: ["a"] }, [{ tabs: ["b"] }, { tabs: ["c"] }]], "HORIZONTAL");
    await renderWorkbench("a");
    const dividers = document.querySelectorAll(".dv-sash");
    expect(dividers.length).toBeGreaterThanOrEqual(2);
    const nodeOf = (divider: Element) =>
      divider.closest(".dv-split-view-container")?.parentElement as Element;
    const [outer] = dividersOf(top() as Element);
    const [inner] = dividersOf(within("vertical") as Element);
    expect(splitLocation(nodeOf(outer as Element))).toEqual([]);
    expect(splitLocation(nodeOf(inner as Element))).toEqual([1]);
  });
});

describe("double-clicking a divider", () => {
  it("evens out every part of its split, not only the two beside it", async () => {
    saveGrid(
      [
        { tabs: ["a"], size: 100 },
        { tabs: ["b"], size: 200 },
        { tabs: ["c"], size: 300 },
        { tabs: ["d"], size: 600 },
      ],
      "HORIZONTAL",
    );
    await renderWorkbench("a");
    await waitFor(() => expect(even(widths())).toBe(false));
    await userEvent.dblClick(dividersOf(top() as Element)[1] as Element);
    await waitFor(() => expect(even(widths())).toBe(true));
    expect(widths()).toHaveLength(4);
  });

  it("evens out a split within another, leaving the other as it is", async () => {
    // A wide Group on top of three side by side.
    saveGrid(
      [
        { tabs: ["a"], size: 500 },
        [
          { tabs: ["b"], size: 200 },
          { tabs: ["c"], size: 300 },
          { tabs: ["d"], size: 700 },
        ],
      ],
      "VERTICAL",
    );
    await renderWorkbench("a");
    await waitFor(() => expect(even(widths().slice(1))).toBe(false));
    const [aHeight, rowHeight] = [heights()[0], heights()[1]];
    await userEvent.dblClick(dividersOf(within("horizontal") as Element)[0] as Element);
    await waitFor(() => expect(even(widths().slice(1))).toBe(true));
    expect([heights()[0], heights()[1]]).toEqual([aHeight, rowHeight]);
    expect(widths()[0]).toBeGreaterThan(WIDTH - 4); // the wide one, as wide still
    await userEvent.dblClick(dividersOf(top() as Element)[0] as Element);
    await waitFor(() => expect(even([heights()[0] ?? 0, heights()[1] ?? 0])).toBe(true));
    expect(even(widths().slice(1))).toBe(true);
  });

  it("evens out a split of splits, through a Group of each", async () => {
    // Two rows, each of two Groups side by side, beside a Group: the rows' split has no Group of its own.
    saveGrid(
      [
        { tabs: ["x"], size: 400 },
        [
          [{ tabs: ["a"] }, { tabs: ["b"] }],
          [{ tabs: ["c"] }, { tabs: ["d"] }],
        ],
      ],
      "HORIZONTAL",
    );
    await renderWorkbench("x");
    const rows = within("vertical") as Element;
    // The rows uneven first, by their divider dragged down.
    await drag(dividersOf(rows)[0] as Element, 0, 200);
    await waitFor(() => expect(even([heights()[1] ?? 0, heights()[3] ?? 0])).toBe(false));
    const xWidth = widths()[0];
    await userEvent.dblClick(dividersOf(rows)[0] as Element);
    await waitFor(() => expect(even([heights()[1] ?? 0, heights()[3] ?? 0])).toBe(true));
    expect(widths()[0]).toBe(xWidth);
  });
});

/** Drags a divider by this much, as the pointer does. */
async function drag(divider: Element, dx: number, dy: number) {
  const { x, y, width, height } = divider.getBoundingClientRect();
  const [startX, startY] = [x + width / 2, y + height / 2];
  const at = (clientX: number, clientY: number) => ({
    clientX,
    clientY,
    bubbles: true,
    pointerId: 1,
    isPrimary: true,
    button: 0,
  });
  divider.dispatchEvent(new PointerEvent("pointerdown", at(startX, startY)));
  for (const step of [0.5, 1]) {
    document.dispatchEvent(
      new PointerEvent("pointermove", at(startX + dx * step, startY + dy * step)),
    );
  }
  document.dispatchEvent(new PointerEvent("pointerup", at(startX + dx, startY + dy)));
  await new Promise((done) => requestAnimationFrame(done));
}

describe("a divider", () => {
  it("still drags, and a click alone changes nothing", async () => {
    saveGrid([{ tabs: ["a"] }, { tabs: ["b"] }], "HORIZONTAL");
    await renderWorkbench("a");
    await waitFor(() => expect(even(widths())).toBe(true));
    const [divider] = dividersOf(top() as Element);
    await userEvent.click(divider as Element);
    expect(even(widths())).toBe(true);
    await drag(divider as Element, 200, 0);
    await waitFor(() => expect((widths()[0] ?? 0) - (widths()[1] ?? 0)).toBeGreaterThan(300));
  });
});
