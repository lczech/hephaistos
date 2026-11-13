// The matchers of jest-dom before those of Vitest's browser, which declare some anew, narrower.
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { type RefObject, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { userEvent as pointer } from "vitest/browser"; // real input, as a person's
import type { ListLayout } from "./kept";
import { Chevron, List, type ListHandle, type Tone } from "./List";
import { listColumnHelper, useList } from "./table";

interface Fruit {
  name: string;
}

const column = listColumnHelper<Fruit>();
const FRUITS = Array.from({ length: 40 }, (_, at) => ({ name: `fruit ${at + 1}` }));

/** Fruits in a Panel as high as a few of them, more of them to load. */
function Fruits({
  fetchNextPage,
  isFetching = false,
}: {
  fetchNextPage: () => void;
  isFetching?: boolean; // all pages loading anew
}) {
  const columns = column.columns([
    column.display({ id: "square", cell: Chevron }),
    column.accessor("name", { header: "name" }),
  ]);
  const table = useList("fruits", "columns", { columns, data: FRUITS });
  return (
    <div style={{ height: 200, overflow: "auto" }}>
      <List
        table={table}
        label="Fruits"
        layout="columns"
        choices={{}}
        message={null}
        paging={{ hasNextPage: true, isFetchingNextPage: false, isFetching, fetchNextPage }}
        older="fruits"
        detailsLabel="Fruit details"
        details={(fruit) => fruit.name}
      />
    </div>
  );
}

describe("a list with more to load", () => {
  it("loads them only once its end comes into view", async () => {
    const fetchNextPage = vi.fn();
    render(<Fruits fetchNextPage={fetchNextPage} />);
    const end = screen.getByText("Older fruits load as you scroll.");
    await new Promise((done) => setTimeout(done, 200)); // the observer's first report
    expect(fetchNextPage).not.toHaveBeenCalled();
    end.scrollIntoView();
    await waitFor(() => expect(fetchNextPage).toHaveBeenCalledOnce());
  });

  it("waits for all pages loading anew, which the next would cut short", async () => {
    const fetchNextPage = vi.fn();
    const { rerender } = render(<Fruits fetchNextPage={fetchNextPage} isFetching />);
    screen.getByText("Older fruits load as you scroll.").scrollIntoView();
    await new Promise((done) => setTimeout(done, 200)); // the first report of the observer
    expect(fetchNextPage).not.toHaveBeenCalled();
    rerender(<Fruits fetchNextPage={fetchNextPage} />);
    await waitFor(() => expect(fetchNextPage).toHaveBeenCalledOnce());
  });
});

/** A fruit with a long name, in a list this wide, after this many others. */
function Long({ name, width, after = 0 }: { name: string; width: number; after?: number }) {
  const columns = column.columns([
    column.display({ id: "square", cell: Chevron, meta: { width: "var(--square)" } }),
    column.accessor("name", { header: "name", size: 60 }),
  ]);
  const table = useList("long", "columns", {
    columns,
    data: [...Array.from({ length: after }, (_, at) => ({ name: `fruit ${at + 1}` })), { name }],
  });
  return (
    <div style={{ width, height: 200, display: "flex", flexDirection: "column" }}>
      <List
        table={table}
        label="Fruits"
        layout="columns"
        choices={{}}
        message={null}
        older="fruits"
        detailsLabel="Fruit details"
        details={(fruit) => fruit.name}
        widths={{ name: "--name-width" }}
      />
    </div>
  );
}

describe("a column's edge", () => {
  it("shows a thin line as high as the text, the whole height under the pointer", async () => {
    render(<Long name="a fruit" width={800} />);
    const edge = document.querySelector('[data-column="name"] hr') as HTMLElement;
    const size = () => getComputedStyle(edge).backgroundSize;
    const [width, height] = size().split(" ").map(Number.parseFloat);
    expect(width).toBe(1);
    expect(height).toBeCloseTo(Number.parseFloat(getComputedStyle(edge).lineHeight), 1);
    await pointer.hover(edge);
    await waitFor(() => expect(size()).toMatch(/^\d+(\.\d+)?px 100%$/));
    expect(size()).not.toMatch(/^1px /);
  });
});

describe("a column's edge, dragged", () => {
  it("gives its width to the stylesheet as it goes, as a variable named", () => {
    render(<Long name="a fruit" width={800} />);
    const frame = document.querySelector("[data-layout]") as HTMLElement;
    const named = () => frame.style.getPropertyValue("--name-width");
    expect(named()).toBe("60px");
    const edge = document.querySelector('[data-column="name"] hr') as HTMLElement;
    const x = edge.getBoundingClientRect().left;
    fireEvent.mouseDown(edge, { clientX: x });
    fireEvent.mouseMove(document, { clientX: x + 40 });
    expect(named()).toBe("100px");
    fireEvent.mouseUp(document, { clientX: x + 40 });
  });
});

describe("a column's edge, double-clicked", () => {
  const nameWidth = () => document.querySelector('[data-column="name"]')?.clientWidth ?? 0;
  const fitName = () =>
    fireEvent.doubleClick(document.querySelector('[data-column="name"] hr') as Element);

  it("fits the column to its widest cell", async () => {
    render(<Long name="a rather long name for a fruit" width={800} />);
    const cell = screen.getByText("a rather long name for a fruit");
    expect(cell.scrollWidth).toBeGreaterThan(nameWidth());
    fitName();
    await waitFor(() => expect(nameWidth()).toBeGreaterThanOrEqual(cell.scrollWidth));
    expect(nameWidth()).toBeLessThan(cell.scrollWidth + 2);
  });

  it("fits it to the rows drawn, near the view, not to those far from it", async () => {
    render(<Long name="a rather long name for a fruit" width={800} after={300} />);
    expect(screen.queryByText("a rather long name for a fruit")).toBeNull();
    fitName();
    await waitFor(() => expect(nameWidth()).toBeLessThan(100));
    const frame = document.querySelector("[data-layout]") as HTMLElement;
    frame.scrollTop = frame.scrollHeight;
    const cell = await screen.findByText("a rather long name for a fruit");
    fitName();
    await waitFor(() => expect(nameWidth()).toBeGreaterThanOrEqual(cell.scrollWidth));
  });

  it("but no wider than the list", async () => {
    render(<Long name={"long ".repeat(100)} width={300} />);
    const list = document.querySelector("[data-layout]") as HTMLElement;
    fitName();
    await waitFor(() => expect(nameWidth()).toBe(list.clientWidth)); // a scrollbar's room left out
    expect(list.clientWidth).toBeLessThanOrEqual(300);
  });
});

/** Fruits by name and colour, as wide as they ask. */
function Coloured() {
  const columns = column.columns([
    column.display({ id: "square", cell: Chevron, meta: { width: "var(--square)" } }),
    column.accessor("name", { header: "name" }),
    column.display({ id: "colour", header: "colour", cell: () => "red" }),
  ]);
  const table = useList("coloured", "columns", { columns, data: [{ name: "apple" }] });
  return (
    <div style={{ width: 600, height: 200, display: "flex", flexDirection: "column" }}>
      <List
        table={table}
        label="Fruits"
        layout="columns"
        choices={{}}
        message={null}
        older="fruits"
        detailsLabel="Fruit details"
        details={(fruit) => fruit.name}
      />
    </div>
  );
}

describe("a list's rows", () => {
  it("are drawn only near the view, as it scrolls", async () => {
    render(<Long name="last" width={800} after={300} />);
    expect(screen.getByText("fruit 1")).toBeVisible();
    expect(screen.queryByText("last")).toBeNull();
    const frame = document.querySelector("[data-layout]") as HTMLElement;
    frame.scrollTop = frame.scrollHeight;
    expect(await screen.findByText("last")).toBeVisible();
    await waitFor(() => expect(screen.queryByText("fruit 1")).toBeNull());
  });

  it("line up their cells below the headers, as they are set", async () => {
    const { container } = render(<Coloured />);
    const lined = () => {
      const [header, cell] = container.querySelectorAll('[data-column="colour"]');
      return [header, cell].map((at) => at?.getBoundingClientRect().left);
    };
    const [header, cell] = lined();
    expect(cell).toBeCloseTo(header ?? 0, 1);
    fireEvent.doubleClick(document.querySelector('[data-column="name"] hr') as Element);
    await waitFor(() => expect(lined()[0]).not.toBeCloseTo(header ?? 0, 1));
    expect(lined()[1]).toBeCloseTo(lined()[0] ?? 0, 1);
  });
});

describe("a list's header menu, open", () => {
  // A click lands on what React Aria lays over the page while it is open.
  const clickOver = (element: Element) => {
    const { left, top } = element.getBoundingClientRect();
    const over = document.querySelector('[data-testid="underlay"]') as Element;
    return fireEvent.contextMenu(over, { clientX: left + 5, clientY: top + 5 });
  };

  it("opens anew for another header clicked", async () => {
    render(<Coloured />);
    fireEvent.contextMenu(screen.getByText("name"));
    await screen.findByRole("menuitem", { name: 'Move "name" right' });
    clickOver(document.querySelector('[data-column="colour"]') as Element); // its header
    await screen.findByRole("menuitem", { name: 'Move "colour" left' });
    expect(screen.getAllByRole("menu")).toHaveLength(1);
  });

  it("closes for anything else clicked", async () => {
    render(<Coloured />);
    fireEvent.contextMenu(screen.getByText("name"));
    await screen.findByRole("menu");
    clickOver(screen.getByText("red"));
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });
});

/**
 * Drags `from` onto `to`, dropping it `x` from its left edge, by the browser's own drag events:
 * Vitest's dragAndDrop moves no native drag into its frame.
 */
function drag(from: Element, to: Element, x: number) {
  const data = new DataTransfer();
  const box = to.getBoundingClientRect();
  const fire = (target: Element, type: string) =>
    target.dispatchEvent(
      new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        dataTransfer: data,
        clientX: box.left + x,
        clientY: box.top + box.height / 2,
      }),
    );
  fire(from, "dragstart");
  for (const type of ["dragenter", "dragover", "drop"]) fire(to, type);
  fire(from, "dragend");
}

describe("a header dragged", () => {
  const headers = () =>
    [...document.querySelectorAll("[data-column]")]
      .filter((cell) => cell.closest("[role=rowgroup]") === null)
      .map((cell) => cell.getAttribute("data-column"));
  const header = (id: string) => document.querySelector(`[data-column="${id}"]`) as Element;

  it("moves its column to the gap it is dropped nearest, keeping it so", async () => {
    render(<Coloured />);
    drag(header("colour"), header("name"), 4); // before the name's middle
    await waitFor(() => expect(headers()).toEqual(["square", "colour", "name"]));
    expect(localStorage.getItem("hephaistos.lists.coloured.order")).toBe('["colour","name"]');
    drag(header("colour"), header("name"), 140); // after it
    await waitFor(() => expect(headers()).toEqual(["square", "name", "colour"]));
  });

  it("not by its edge, which resizes it", () => {
    render(<Coloured />);
    const edge = header("name").querySelector("hr") as Element;
    expect(fireEvent.mouseDown(edge)).toBe(false); // a drag cannot start
  });
});

interface Node {
  name: string;
  subRows: Node[];
}

const node = listColumnHelper<Node>();
const FOLDER: Node = {
  name: "src",
  subRows: Array.from({ length: 30 }, (_, at) => ({ name: `file ${at + 1}`, subRows: [] })),
};

/** A tree in a Panel as high as a few rows, its folder open, quiet and marked as shown. */
function Tree({ embedded = false }: { embedded?: boolean }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ src: true });
  const columns = node.columns([
    node.display({ id: "square", cell: Chevron, meta: { width: "var(--square)" } }),
    node.accessor("name", { header: "name" }),
  ]);
  const table = useList("tree", "columns", {
    columns,
    data: [FOLDER],
    getRowId: (row) => row.name,
    getSubRows: (row) => row.subRows,
    getRowCanExpand: (row) => row.original.subRows.length > 0,
    state: { expanded },
    onExpandedChange: (change) =>
      setExpanded((was) => (typeof change === "function" ? change(was) : change) as typeof was),
  });
  return (
    <div style={{ height: 160, display: "flex", flexDirection: "column" }}>
      <List
        table={table}
        label="Files"
        layout="columns"
        tree
        embedded={embedded}
        choices={{}}
        message={null}
        older="files"
        detailsLabel="Details"
        details={() => null}
        folds={(row) => row.subRows.length > 0}
        tone={(row) => (row.subRows.length > 0 ? "muted" : undefined)}
        showing={(row) => row.subRows.length > 0}
      />
    </div>
  );
}

/** The row, not its item, saying `name`. */
const rowOf = (name: string) => screen.getByText(name).closest("[id]") as HTMLElement;

describe("a list as a tree", () => {
  it("keeps a row's tone to itself, not the rows within it", () => {
    render(<Tree />);
    const { color } = getComputedStyle(rowOf("src"));
    expect(getComputedStyle(rowOf("file 1")).color).not.toBe(color);
  });

  it("brings a row focused into view below the rows stuck above it", async () => {
    render(<Tree />);
    const frame = document.querySelector("[data-tree]") as HTMLElement;
    const head = frame.firstElementChild?.firstElementChild as HTMLElement;
    frame.scrollTop = 300; // "file 5" above the view, still drawn, "src" stuck
    await waitFor(() => expect(rowOf("file 5").getBoundingClientRect().bottom).toBeLessThan(0));
    within(rowOf("file 5")).getByRole("button").focus(); // as Shift+Tab moves up to it
    await waitFor(() => {
      const src = seenAt(head.getBoundingClientRect().bottom + 1);
      expect(src?.name).toBe("src");
      expect(rowOf("file 5").getBoundingClientRect().top).toBeGreaterThanOrEqual(
        (src?.box.bottom ?? 0) - 1,
      );
    });
  });

  it("lines up the rows within a row below the headers too", () => {
    render(<Tree />);
    const [header, ...cells] = document.querySelectorAll('[data-column="name"]');
    const left = (at: Element | undefined) => at?.getBoundingClientRect().left ?? Number.NaN;
    expect(cells.length).toBeGreaterThan(1);
    for (const cell of cells) expect(left(cell)).toBeCloseTo(left(header), 1);
  });

  it("sticks an open row, still marked as shown", async () => {
    render(<Tree />);
    const frame = document.querySelector("[data-tree]") as HTMLElement;
    const head = frame.firstElementChild?.firstElementChild as HTMLElement;
    frame.scrollTop = 200;
    await drawn();
    const stuck = document.elementFromPoint(
      head.getBoundingClientRect().left + 100,
      head.getBoundingClientRect().bottom + 2,
    );
    const row = stuck?.closest("[role=row] > div") as HTMLElement;
    expect(row.textContent).toContain("src");
    expect(getComputedStyle(row).backgroundImage).toMatch(/gradient/); // its mark, over the page's colour
  });

  it("scrolls a row stuck, once clicked, to its place at the top, then closes it", async () => {
    render(<Tree />);
    const frame = document.querySelector("[data-tree]") as HTMLElement;
    const head = frame.firstElementChild?.firstElementChild as HTMLElement;
    frame.scrollTop = 200;
    await drawn();
    const y = head.getBoundingClientRect().bottom + 2;
    expect(seenAt(y)?.name).toBe("src");
    fireEvent.click(
      document.elementFromPoint(head.getBoundingClientRect().left + 100, y) as Element,
    );
    await waitFor(() => expect(screen.queryByText("file 1")).toBeNull()); // closed
    expect(ownRowOf("src").getBoundingClientRect().top).toBeCloseTo(
      head.getBoundingClientRect().bottom,
      0,
    );
    await waitFor(() => expect(ownRowOf("src").parentElement).toHaveFocus()); // the row, not its copy
  });
});

/** A tree part of a page that scrolls, below and above other content, as the Diff's. */
/** A tree within a page, its folder open; `onDraw` told of each row's name drawn. */
function PageTree({ onDraw }: { onDraw?: () => void }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ src: true });
  const columns = node.columns([
    node.display({ id: "square", cell: Chevron, meta: { width: "var(--square)" } }),
    node.accessor("name", {
      header: "name",
      cell: (cell) => {
        onDraw?.();
        return cell.getValue();
      },
    }),
  ]);
  const table = useList("page-tree", "columns", {
    columns,
    data: [FOLDER, { name: "after", subRows: [] }],
    getRowId: (row) => row.name,
    getSubRows: (row) => row.subRows,
    getRowCanExpand: (row) => row.original.subRows.length > 0,
    state: { expanded },
    onExpandedChange: (change) =>
      setExpanded((was) => (typeof change === "function" ? change(was) : change) as typeof was),
  });
  return (
    <div data-testid="page" style={{ height: 200, overflowY: "auto" }}>
      <p style={{ height: 100, margin: 0 }}>Above</p>
      <List
        table={table}
        label="Files"
        layout="columns"
        tree
        embedded
        choices={{}}
        message={null}
        older="files"
        detailsLabel="Details"
        details={() => null}
        folds={(row) => row.subRows.length > 0}
      />
      <p style={{ height: 400, margin: 0 }}>Below</p>
    </div>
  );
}

describe("a tree part of a page", () => {
  it("moves its rows stuck as the page scrolls, without drawing its rows anew", async () => {
    let draws = 0;
    render(<PageTree onDraw={() => draws++} />);
    const page = screen.getByTestId("page");
    page.scrollTop = 300;
    await drawn();
    const top = page.getBoundingClientRect().top;
    expect(seenAt(top + 1)?.name).toBe("src");
    const rows = document.querySelectorAll("[role=rowgroup] > [role=row]").length;
    draws = 0;
    for (let step = 0; step < 10; step++) {
      page.scrollTop += 2;
      await drawn();
      expect(seenAt(top + 1)?.box.top).toBeCloseTo(top, 0); // the copy, moved with the page
    }
    // Anew only as scrolling starts and stops, and as the rows near the view change: a few
    // times, not at each scroll, ten times.
    expect(draws).toBeLessThan(rows * 5);
  });

  it("draws only its rows near the view of the page", async () => {
    render(<PageTree />);
    expect(screen.getByText("file 1")).toBeVisible();
    expect(screen.queryByText("file 30")).toBeNull();
    screen.getByTestId("page").scrollTop = 600;
    expect(await screen.findByText("file 30")).toBeVisible();
  });

  it("keeps an open row at the top of the page as it scrolls, its rows passing below", async () => {
    render(<PageTree />);
    const page = screen.getByTestId("page");
    const top = page.getBoundingClientRect().top;
    for (const by of [300, 310, 320, 330]) {
      page.scrollTop = by;
      await drawn();
      expect(seenAt(top + 1)?.box.top).toBeCloseTo(top, 0);
    }
  });

  it("sticks an open row at the top of the page, pushed up by the end of its rows", async () => {
    render(<PageTree />);
    const page = screen.getByTestId("page");
    const top = page.getBoundingClientRect().top;
    page.scrollTop = 300;
    await drawn();
    const src = seenAt(top + 1);
    expect(src?.name).toBe("src");
    expect(src?.box.top).toBeCloseTo(top, 0);
    // Scrolled until the last of its rows reaches it: it is pushed up, out of the page.
    while (screen.queryAllByText("file 30").length === 0) {
      page.scrollTop += 100;
      await drawn();
    }
    const last = ownRowOf("file 30").getBoundingClientRect();
    page.scrollTop += last.bottom - top - (src?.box.height ?? 0) / 2;
    await drawn();
    const pushed = seenAt(top + 1);
    expect(pushed?.name).toBe("src");
    expect(pushed?.box.bottom).toBeCloseTo(ownRowOf("file 30").getBoundingClientRect().bottom, 0);
  });
});

const nested = (count: number, name: string): Node[] =>
  Array.from({ length: count }, (_, at) => ({ name: `${name} ${at + 1}`, subRows: [] }));

/** A compact tree two folders deep, sorted by name, in one layout or the other. */
function Deep({ layout }: { layout: ListLayout }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ src: true, inner: true });
  const columns = node.columns([
    node.display({ id: "square", cell: Chevron, meta: { width: "var(--square)" } }),
    node.accessor("name", { header: "name", enableSorting: true }),
  ]);
  const table = useList(`deep-${layout}`, layout, {
    columns,
    data: [{ name: "src", subRows: [{ name: "inner", subRows: nested(40, "file") }] }],
    getRowId: (row) => row.name,
    getSubRows: (row) => row.subRows,
    getRowCanExpand: (row) => row.original.subRows.length > 0,
    state: { expanded, sorting: [{ id: "name", desc: false }] },
    manualSorting: true,
    onExpandedChange: (change) =>
      setExpanded((was) => (typeof change === "function" ? change(was) : change) as typeof was),
  });
  return (
    <div style={{ height: 300, display: "flex", flexDirection: "column" }}>
      <List
        table={table}
        label="Files"
        layout={layout}
        tree
        compact
        oneLine
        choices={{}}
        message={null}
        older="files"
        detailsLabel="Details"
        details={() => null}
        folds={(row) => row.subRows.length > 0}
      />
    </div>
  );
}

describe("a tree's rows stuck below its header", () => {
  it.each(["columns", "lines"] as const)("lie each below the one before, in %s", async (layout) => {
    render(<Deep layout={layout} />);
    const frame = document.querySelector("[data-tree]") as HTMLElement;
    frame.scrollTop = frame.scrollHeight;
    const head = frame.firstElementChild?.firstElementChild as HTMLElement; // in the grid
    await waitFor(() => {
      const src = seenAt(head.getBoundingClientRect().bottom + 1);
      const inner = seenAt((src?.box.bottom ?? 0) + 1);
      expect([src?.name, inner?.name]).toEqual(["src", "inner"]);
      expect(src?.box.top).toBeCloseTo(head.getBoundingClientRect().bottom, 0);
      expect(inner?.box.top).toBeCloseTo(src?.box.bottom ?? 0, 0);
    });
  });

  it("lie on the background, from the header to the lowest, no row passing below between", async () => {
    render(<Deep layout="columns" />);
    const frame = document.querySelector("[data-tree]") as HTMLElement;
    const head = frame.firstElementChild?.firstElementChild as HTMLElement;
    frame.scrollTop = frame.scrollHeight;
    await drawn();
    const top = head.getBoundingClientRect().bottom;
    const src = seenAt(top + 1);
    const inner = seenAt((src?.box.bottom ?? 0) + 1);
    expect(inner?.name).toBe("inner");
    const x = head.getBoundingClientRect().right - 10; // past the names
    for (let y = top - 1; y < (inner?.box.bottom ?? 0) - 0.5; y += 0.25) {
      const at = document.elementFromPoint(x, y) as Element;
      expect(head.contains(at) || at.closest("[aria-hidden]") !== null).toBe(true);
    }
  });
});

/** Two frames: drawn after a scroll, wherever the List places its rows. */
const drawn = () =>
  new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null))));

/** Scrolls an element, once the browser has said so, as the list keeps where it was by it. */
async function scrolled(element: HTMLElement, top: number): Promise<void> {
  const said = new Promise((done) => element.addEventListener("scroll", done, { once: true }));
  element.scrollTop = top;
  await said; // under load, maybe only after a frame or two
}

/** The name of the row seen at `y`, in the middle of its name, and its box; none outside rows. */
function seenAt(y: number): { name: string; box: DOMRect } | undefined {
  const cell = document.querySelector('[data-column="name"]') as HTMLElement; // its header
  const { left, width } = cell.getBoundingClientRect();
  const row = document.elementFromPoint(left + width / 2, y)?.closest("[role=row] > div");
  const name = row?.querySelector(':scope > [data-column="name"]')?.textContent;
  return row && name ? { name, box: row.getBoundingClientRect() } : undefined;
}

/** A row of the list itself, not a copy of it stuck (hidden from screen readers). */
const ownRowOf = (name: string) =>
  screen
    .getAllByText(name)
    .map((text) => text.closest("[role=row] > div") as HTMLElement)
    .find((row) => row.closest("[aria-hidden]") === null) as HTMLElement;

/**
 * A tree three levels deep: `src` holding `inner` (a few files) and files of its own, then files
 * of the top level; all open, so that scrolling down slides `inner` out, then `src`.
 */
function Layered({ height = 240 }: { height?: number }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ src: true, inner: true });
  const columns = node.columns([
    node.display({ id: "square", cell: Chevron, meta: { width: "var(--square)" } }),
    node.accessor("name", { header: "name" }),
  ]);
  const table = useList("layered", "columns", {
    columns,
    data: [
      {
        name: "src",
        subRows: [{ name: "inner", subRows: nested(12, "deep") }, ...nested(12, "own")],
      },
      ...nested(20, "top"),
    ],
    getRowId: (row) => row.name,
    getSubRows: (row) => row.subRows,
    getRowCanExpand: (row) => row.original.subRows.length > 0,
    state: { expanded },
    onExpandedChange: (change) =>
      setExpanded((was) => (typeof change === "function" ? change(was) : change) as typeof was),
  });
  return (
    <div style={{ height, display: "flex", flexDirection: "column" }}>
      <List
        table={table}
        label="Files"
        layout="columns"
        tree
        compact
        oneLine
        choices={{}}
        message={null}
        older="files"
        detailsLabel="Details"
        details={() => null}
        folds={(row) => row.subRows.length > 0}
      />
    </div>
  );
}

describe("a tree's rows stuck, as seen", () => {
  // Scrolled a pixel at a time past the end of what a row holds: it is seen below the one holding
  // it, until the end of what it holds pushes it up, out of view, below the one holding it.
  it.each([
    ["inner", "deep 12", "src"],
    ["src", "own 12", undefined],
  ])("slide out as the end of what they hold reaches them: %s", async (name, last, holder) => {
    render(<Layered />);
    const frame = document.querySelector("[data-tree]") as HTMLElement;
    const head = frame.firstElementChild?.firstElementChild as HTMLElement;
    // Scrolled to `last`, drawn only near the view, to know where it ends.
    while (screen.queryAllByText(last).length === 0) {
      frame.scrollTop += 100;
      await drawn();
    }
    const at =
      ownRowOf(last).getBoundingClientRect().bottom -
      frame.getBoundingClientRect().top +
      frame.scrollTop;
    let slid = 0;
    for (let by = Math.round(at) - 90; by < at; by += 1) {
      frame.scrollTop = by;
      await drawn();
      const top = holder
        ? (seenAt(head.getBoundingClientRect().bottom + 1)?.box.bottom ?? 0)
        : head.getBoundingClientRect().bottom;
      const bottom = ownRowOf(last).getBoundingClientRect().bottom;
      const seen = seenAt(top + 0.5);
      if (bottom <= top + 0.5) continue; // gone below the one holding it
      expect(seen?.name).toBe(name);
      const height = seen?.box.height ?? 0;
      expect(seen?.box.bottom).toBeCloseTo(Math.min(top + height, bottom), 0);
      if (bottom < top + height - 0.5) slid += 1;
    }
    expect(slid).toBeGreaterThan(5); // seen sliding, not only stuck
  });

  it("lie evenly apart, each at the height of a row", async () => {
    render(<Layered />);
    const tops = [...document.querySelectorAll("[role=row] > div")]
      .filter((row) => row.closest("[aria-hidden]") === null)
      .map((row) => row.getBoundingClientRect())
      .filter((box) => box.height > 0)
      .map((box) => box.top)
      .sort((a, b) => a - b);
    const height = ownRowOf("deep 1").getBoundingClientRect().height;
    expect(tops.length).toBeGreaterThan(5);
    for (const [at, top] of tops.slice(1).entries()) {
      expect(top - (tops[at] ?? 0)).toBeCloseTo(height, 2);
    }
  });
});

/** Fruits in a Panel, more of them coming before them as `ahead` grows. */
function Growing({ ahead }: { ahead: number }) {
  const columns = column.columns([
    column.display({ id: "square", cell: Chevron }),
    column.accessor("name", { header: "name" }),
  ]);
  const data = [
    ...Array.from({ length: ahead }, (_, at) => ({ name: `new ${at + 1}` })),
    ...FRUITS,
  ];
  const table = useList("growing", "columns", { columns, data, getRowId: (row) => row.name });
  return (
    <div style={{ height: 200, display: "flex", flexDirection: "column" }}>
      <List
        table={table}
        label="Fruits"
        layout="columns"
        choices={{}}
        message={null}
        older="fruits"
        detailsLabel="Fruit details"
        details={(fruit) => fruit.name}
      />
    </div>
  );
}

describe("a list's rows in view", () => {
  it("stay where they are as rows come before them", async () => {
    const { rerender } = render(<Growing ahead={0} />);
    const frame = document.querySelector("[data-layout]") as HTMLElement;
    await scrolled(frame, 200);
    await drawn();
    const before = ownRowOf("fruit 20").getBoundingClientRect().top;
    rerender(<Growing ahead={5} />);
    await drawn();
    expect(ownRowOf("fruit 20").getBoundingClientRect().top).toBeCloseTo(before, 0);
  });

  it("but at the very top, the rows come into view", async () => {
    const { rerender } = render(<Growing ahead={0} />);
    await drawn();
    rerender(<Growing ahead={5} />);
    await drawn();
    const frame = document.querySelector("[data-layout]") as HTMLElement;
    expect(frame.scrollTop).toBe(0);
    expect(ownRowOf("new 1").getBoundingClientRect().top).toBeLessThan(
      ownRowOf("fruit 1").getBoundingClientRect().top,
    );
  });

  it("are the same once a Panel hidden is shown again", async () => {
    render(<Growing ahead={0} />);
    const frame = document.querySelector("[data-layout]") as HTMLElement;
    await scrolled(frame, 200);
    await drawn();
    const [top, before] = [frame.scrollTop, ownRowOf("fruit 20").getBoundingClientRect().top];
    expect(top).toBeGreaterThan(100);
    // As dockview hides a Panel drawn while hidden.
    const panel = frame.parentElement as HTMLElement;
    panel.style.visibility = "hidden";
    await drawn();
    panel.style.visibility = "";
    await drawn();
    expect(frame.scrollTop).toBe(top);
    expect(ownRowOf("fruit 20").getBoundingClientRect().top).toBeCloseTo(before, 0);
  });
});

describe("a list's row focused by the keys", () => {
  const frame = () => document.querySelector("[data-layout]") as HTMLElement;

  it("stays drawn and focused while scrolled away, and the next comes into view", async () => {
    render(<Long name="last" width={800} after={300} />);
    await userEvent.tab();
    expect(ownRowOf("fruit 1").parentElement).toHaveFocus();
    frame().scrollTop = frame().scrollHeight;
    await screen.findByText("last");
    expect(ownRowOf("fruit 1").parentElement).toHaveFocus(); // still drawn
    await userEvent.keyboard("{ArrowDown}");
    await waitFor(() => expect(ownRowOf("fruit 2").parentElement).toHaveFocus());
    const head = frame().firstElementChild?.firstElementChild as HTMLElement;
    const row = ownRowOf("fruit 2").getBoundingClientRect();
    expect(row.top).toBeGreaterThanOrEqual(head.getBoundingClientRect().bottom - 1);
  });

  it("moves a page down, to the last row in view, and the next page brings more", async () => {
    render(<Long name="last" width={800} after={300} />);
    await userEvent.tab();
    await userEvent.keyboard("{PageDown}");
    const view = frame().getBoundingClientRect();
    const focused = () => document.activeElement?.getBoundingClientRect() ?? new DOMRect();
    await waitFor(() => expect(document.activeElement?.textContent).not.toContain("fruit 1"));
    expect(focused().bottom).toBeLessThanOrEqual(view.bottom + 1);
    expect(focused().bottom).toBeGreaterThan(view.bottom - 2 * focused().height);
    const before = document.activeElement?.textContent;
    await userEvent.keyboard("{PageDown}");
    await waitFor(() => expect(document.activeElement?.textContent).not.toBe(before));
    expect(focused().bottom).toBeLessThanOrEqual(view.bottom + 1);
  });

  // Not after a click, which a real pointer must make: checked in the app, as scripted events
  // make the browser take the focus for the keyboard's.
  it("shows a ring around the row focused by the keys", async () => {
    render(<Long name="last" width={800} />);
    expect(getComputedStyle(ownRowOf("last")).outlineStyle).toBe("none");
    await userEvent.tab();
    await userEvent.keyboard("{End}");
    expect(ownRowOf("last").parentElement).toHaveFocus();
    expect(getComputedStyle(ownRowOf("last")).outlineStyle).toBe("solid");
  });
});

/** Groups of files, as Changes shows them: each group a row holding its files, a line above. */
function Groups() {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    staged: true,
    unstaged: true,
  });
  const columns = node.columns([
    node.display({ id: "square", cell: Chevron, meta: { width: "var(--square)" } }),
    node.accessor("name", { header: "name" }),
  ]);
  const table = useList("groups", "columns", {
    columns,
    data: [
      { name: "staged", subRows: nested(20, "staged") },
      { name: "unstaged", subRows: nested(20, "unstaged") },
    ],
    getRowId: (row) => row.name,
    getSubRows: (row) => row.subRows,
    getRowCanExpand: (row) => row.original.subRows.length > 0,
    state: { expanded },
    onExpandedChange: (change) =>
      setExpanded((was) => (typeof change === "function" ? change(was) : change) as typeof was),
  });
  return (
    <div style={{ height: 240, display: "flex", flexDirection: "column" }}>
      <List
        table={table}
        label="Changes"
        layout="columns"
        grouped
        tree
        choices={{}}
        message={null}
        older="files"
        detailsLabel="Details"
        details={() => null}
        folds={(row) => row.subRows.length > 0}
      />
    </div>
  );
}

describe("a grouped list's rows stuck", () => {
  it("stick only once the row itself passes the header, not the line above it", async () => {
    render(<Groups />);
    const frame = document.querySelector("[data-tree]") as HTMLElement;
    const head = frame.firstElementChild?.firstElementChild as HTMLElement;
    while (screen.queryAllByText("unstaged").length === 0) {
      frame.scrollTop += 100;
      await drawn();
    }
    const at =
      ownRowOf("unstaged").getBoundingClientRect().top -
      frame.getBoundingClientRect().top +
      frame.scrollTop;
    let checked = 0;
    for (let by = Math.round(at) - 60; by < at; by += 1) {
      frame.scrollTop = by;
      await drawn();
      const row = ownRowOf("unstaged").getBoundingClientRect();
      if (row.top < head.getBoundingClientRect().bottom - 0.5) continue; // passing: stuck then
      const copies = [...document.querySelectorAll("[aria-hidden] [role=row]")].map(
        (row) => row.textContent,
      );
      expect(copies).not.toContain("unstaged");
      checked += 1;
    }
    expect(checked).toBeGreaterThan(10); // its line passing the header too
  });
});

describe("a stuck copy of a row within another, clicked", () => {
  it("scrolls that row to its place below the one holding it, closes it, and focuses it", async () => {
    render(<Layered />); // rows after it, so that the list still scrolls once it closes
    const frame = document.querySelector("[data-tree]") as HTMLElement;
    const head = frame.firstElementChild?.firstElementChild as HTMLElement;
    frame.scrollTop = 100;
    await drawn();
    const src = seenAt(head.getBoundingClientRect().bottom + 1);
    const inner = seenAt((src?.box.bottom ?? 0) + 1);
    expect([src?.name, inner?.name]).toEqual(["src", "inner"]);
    const x = head.getBoundingClientRect().left + 100;
    fireEvent.click(document.elementFromPoint(x, (src?.box.bottom ?? 0) + 2) as Element);
    await waitFor(() => expect(screen.queryByText("deep 1")).toBeNull()); // closed
    const row = ownRowOf("inner");
    // Within a pixel: copies lie at whole pixels, and WebKit scrolls by them.
    expect(Math.abs(row.getBoundingClientRect().top - (src?.box.bottom ?? 0))).toBeLessThanOrEqual(
      1,
    );
    await waitFor(() => expect(row.parentElement).toHaveFocus());
  });
});

/** Fruits whose details are taller than the list, as a diff may be. */
function TallDetails() {
  const columns = column.columns([
    column.display({ id: "square", cell: Chevron }),
    column.accessor("name", { header: "name" }),
  ]);
  const table = useList("tall", "columns", { columns, data: FRUITS, getRowId: (row) => row.name });
  return (
    <div style={{ height: 200, display: "flex", flexDirection: "column" }}>
      <List
        table={table}
        label="Fruits"
        layout="columns"
        choices={{}}
        message={null}
        older="fruits"
        detailsLabel="Fruit details"
        details={(fruit) => <div style={{ height: 500 }}>All about {fruit.name}</div>}
      />
    </div>
  );
}

describe("a page of rows, by the keys", () => {
  it("goes to the next row past details taller than the view, not past rows below them", async () => {
    render(<TallDetails />);
    await userEvent.tab();
    await userEvent.keyboard("{Enter}{PageDown}");
    await waitFor(() => expect(ownRowOf("fruit 2").parentElement).toHaveFocus());
    const frame = document.querySelector("[data-layout]") as HTMLElement;
    const row = ownRowOf("fruit 2").getBoundingClientRect();
    expect(row.bottom).toBeLessThanOrEqual(frame.getBoundingClientRect().bottom + 1);
    await userEvent.keyboard("{PageUp}");
    await waitFor(() => expect(ownRowOf("fruit 1").parentElement).toHaveFocus());
  });

  it("goes past details opened just before, not measured yet, as a fast hand would", async () => {
    render(<TallDetails />);
    await userEvent.tab();
    const row = ownRowOf("fruit 1").parentElement as HTMLElement;
    // In one task: no frame between them, in which the opened row would be measured.
    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.keyDown(document.activeElement as Element, { key: "PageDown" });
    await waitFor(() => expect(ownRowOf("fruit 2").parentElement).toHaveFocus());
  });
});

describe("a row clicked", () => {
  it("is focused without the ring, which the keys show", async () => {
    render(<Long name="last" width={800} after={3} />);
    await pointer.click(screen.getByText("last"));
    const row = ownRowOf("last");
    expect(row.parentElement).toHaveFocus();
    expect(getComputedStyle(row).outlineStyle).toBe("none");
    await pointer.keyboard("{ArrowUp}{ArrowDown}");
    expect(row.parentElement).toHaveFocus();
    expect(getComputedStyle(row).outlineStyle).toBe("solid");
  });
});

/** What axe finds wrong for screen readers in the page as drawn: its rules' names and why. */
async function axeFinds(): Promise<string[]> {
  const found = await axe.run(document.body, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] },
    // The page's own landmarks and colours are not the List's.
    rules: { region: { enabled: false }, "color-contrast": { enabled: false } },
  });
  return found.violations.map(
    (violation) =>
      `${violation.id}: ${violation.help} ${violation.nodes.map((node) => node.html.slice(0, 90)).join(" ; ")}`,
  );
}

describe("a list, as axe checks it for screen readers", () => {
  it("in columns, a row's details open and the row focused", async () => {
    render(<Long name="last" width={800} after={5} />);
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    expect(await axeFinds()).toEqual([]);
  });

  it("as a tree scrolled, rows stuck", async () => {
    render(<Deep layout="columns" />);
    const frame = document.querySelector("[data-tree]") as HTMLElement;
    frame.scrollTop = 300;
    await drawn();
    expect(document.querySelectorAll("[aria-hidden] [role=row]").length).toBe(2);
    expect(await axeFinds()).toEqual([]);
  });

  it("in two lines, its header's buttons in one cell", async () => {
    render(<Deep layout="lines" />);
    expect(await axeFinds()).toEqual([]);
  });

  it("as part of a page, its rows stuck at the page's top", async () => {
    render(<PageTree />);
    screen.getByTestId("page").scrollTop = 300;
    await drawn();
    expect(await axeFinds()).toEqual([]);
  });
});

interface Fruity {
  names?: string[]; // as listed, `fruit 1` to `fruit 40` if not given
  height?: number; // of the list's Panel
  layout?: ListLayout;
  open?: string[]; // the rows whose details are open, as given
  tall?: number | ((name: string) => number); // how high their details are
  handle?: RefObject<ListHandle | null>;
  tone?: (name: string) => Tone | undefined;
  band?: boolean; // a band below the header, naming the row at the top
}

const FORTY = Array.from({ length: 40 }, (_, at) => `fruit ${at + 1}`);

/** Fruits as given, some open as given, in a Panel this high: for what moves rows about. */
function Fruity({
  names = FORTY,
  height = 200,
  layout = "columns",
  open,
  tall = 60,
  handle,
  tone,
  band,
}: Fruity) {
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set(open));
  const columns = column.columns([
    column.display({ id: "square", cell: Chevron }),
    column.accessor("name", { header: "name" }),
  ]);
  const table = useList(`fruity-${layout}`, layout, {
    columns,
    data: names.map((name) => ({ name })),
    getRowId: (fruit) => fruit.name,
  });
  const high = (name: string) => (typeof tall === "number" ? tall : tall(name));
  return (
    <div data-testid="panel" style={{ height, display: "flex", flexDirection: "column" }}>
      <List
        table={table}
        label="Fruits"
        layout={layout}
        choices={{}}
        message={null}
        older="fruits"
        detailsLabel="Fruit details"
        details={(fruit) => <div style={{ height: high(fruit.name) }}>All about {fruit.name}</div>}
        opened={opened}
        onOpenedChange={setOpened}
        handle={handle}
        tone={tone && ((fruit) => tone(fruit.name))}
        band={
          band
            ? (fruit, next) => ({
                name: `below ${fruit.name}${next ? `, ${next.row.name} at ${next.at.toFixed(1)} of ${next.height.toFixed(1)}` : ""}`,
              })
            : undefined
        }
      />
    </div>
  );
}

const frameOf = () => document.querySelector("[data-layout]") as HTMLElement;
const headOf = () => frameOf().firstElementChild?.firstElementChild as HTMLElement;
const focusedText = () => document.activeElement?.textContent ?? "";

describe("a list's rows, by the keys, as drawn", () => {
  it("goes a page on with no room below the rows stuck, and back", async () => {
    render(<Layered height={90} />);
    const frame = frameOf();
    frame.scrollTop = 100; // src and inner stuck, their rows passing below
    await drawn();
    (ownRowOf("deep 6").parentElement as HTMLElement).focus();
    await userEvent.keyboard("{PageDown}");
    await waitFor(() => expect(focusedText()).not.toBe("deep 6"));
    const down = focusedText();
    await userEvent.keyboard("{PageUp}");
    await waitFor(() => expect(focusedText()).not.toBe(down));
    expect(focusedText()).not.toMatch(/^(own|top)/); // back up, not further down
  });

  it("goes to the very top by Home", async () => {
    render(<Fruity />);
    await userEvent.tab();
    await userEvent.keyboard("{End}");
    await waitFor(() => expect(focusedText()).toBe("fruit 40"));
    await userEvent.keyboard("{Home}");
    await waitFor(() => expect(frameOf().scrollTop).toBe(0));
  });

  it("brings the row of a group into view whole, below the line starting its group", async () => {
    render(<Groups />);
    const frame = frameOf();
    while (screen.queryAllByText("staged 20").length === 0) {
      frame.scrollTop += 50;
      await drawn();
    }
    (ownRowOf("staged 20").parentElement as HTMLElement).focus();
    // The last of its group at the bottom of the view, the next group's row below it.
    frame.scrollTop +=
      ownRowOf("staged 20").getBoundingClientRect().bottom - frame.getBoundingClientRect().bottom;
    await drawn();
    await userEvent.keyboard("{ArrowDown}");
    await waitFor(() => expect(focusedText()).toBe("unstaged"));
    const row = ownRowOf("unstaged").getBoundingClientRect();
    expect(row.bottom).toBeLessThanOrEqual(frame.getBoundingClientRect().bottom + 0.5);
  });

  it("moves in a list part of a page, a page of the page at a time, the row in its view", async () => {
    render(<PageTree />);
    const page = screen.getByTestId("page");
    (ownRowOf("src").parentElement as HTMLElement).focus();
    await userEvent.keyboard("{PageDown}");
    await waitFor(() => expect(focusedText()).not.toBe("src"));
    const row = (document.activeElement as HTMLElement).getBoundingClientRect();
    const view = page.getBoundingClientRect();
    expect(row.top).toBeGreaterThanOrEqual(view.top);
    expect(row.bottom).toBeLessThanOrEqual(view.bottom + 0.5);
  });

  it("enters by Tab where the view is, in tall details, without scrolling", async () => {
    render(
      <>
        <button type="button">before</button>
        <Fruity open={["fruit 1"]} tall={600} />
      </>,
    );
    frameOf().scrollTop = 300; // within the details of the first
    await drawn();
    screen.getByRole("button", { name: "before" }).focus();
    await userEvent.tab();
    expect(focusedText()).toContain("fruit 1");
    await drawn();
    expect(frameOf().scrollTop).toBe(300);
  });

  it("comes back by Tab to the row focused, below the rows stuck above it", async () => {
    render(
      <>
        <button type="button">before</button>
        <Layered />
      </>,
    );
    (ownRowOf("deep 3").parentElement as HTMLElement).focus();
    screen.getByRole("button", { name: "before" }).focus();
    frameOf().scrollTop = 200; // deep 3 above the view, under the rows stuck
    await drawn();
    await userEvent.tab();
    expect(focusedText()).toBe("deep 3");
    await drawn();
    const stuck = [...document.querySelectorAll("[aria-hidden] [role=row]")].map((row) =>
      row.getBoundingClientRect(),
    );
    const lowest = Math.max(
      headOf().getBoundingClientRect().bottom,
      ...stuck.map((at) => at.bottom),
    );
    expect(ownRowOf("deep 3").getBoundingClientRect().top).toBeGreaterThanOrEqual(lowest - 1);
  });
});

/** The tree of files as given, its folder open or closed from outside, as by a live update. */
function Folding({ open }: { open: boolean }) {
  const columns = node.columns([
    node.display({ id: "square", cell: Chevron }),
    node.accessor("name", { header: "name" }),
  ]);
  const table = useList("folding", "columns", {
    columns,
    data: [FOLDER, { name: "README", subRows: [] }],
    getRowId: (row) => row.name,
    getSubRows: (row) => row.subRows,
    getRowCanExpand: (row) => row.original.subRows.length > 0,
    state: { expanded: { src: open } },
  });
  return (
    <div style={{ height: 200, display: "flex", flexDirection: "column" }}>
      <List
        table={table}
        label="Files"
        layout="columns"
        tree
        choices={{}}
        message={null}
        older="files"
        detailsLabel="Details"
        details={() => null}
        folds={(row) => row.subRows.length > 0}
        plain={(row) => row.subRows.length === 0}
      />
    </div>
  );
}

describe("a list's row focused, gone", () => {
  it("gives the focus to the row holding it, closed", async () => {
    const { rerender } = render(<Folding open />);
    fireEvent.focus(ownRowOf("file 3").parentElement as HTMLElement);
    (ownRowOf("file 3").parentElement as HTMLElement).focus();
    rerender(<Folding open={false} />);
    await waitFor(() => expect(ownRowOf("src").parentElement).toHaveFocus());
  });

  it("gives the focus to the row now at its place, removed", async () => {
    const { rerender } = render(<Fruity />);
    (ownRowOf("fruit 2").parentElement as HTMLElement).focus();
    rerender(<Fruity names={FORTY.filter((name) => name !== "fruit 2")} />);
    await waitFor(() => expect(ownRowOf("fruit 3").parentElement).toHaveFocus());
  });
});

describe("a list's rows of many heights", () => {
  const tall = (name: string) => (Number(name.split(" ")[1]) % 10 === 0 ? 200 : 0);

  it("brings a row far away into view whole, below the header", async () => {
    const handle: RefObject<ListHandle | null> = { current: null };
    const many = Array.from({ length: 300 }, (_, at) => `fruit ${at + 1}`);
    render(
      <Fruity
        names={many}
        open={many.filter((name) => tall(name) > 0)}
        tall={tall}
        handle={handle}
      />,
    );
    expect(handle.current?.scrollTo("fruit 250")).toBe(true);
    await waitFor(() => {
      const row = ownRowOf("fruit 250").getBoundingClientRect();
      expect(row.top).toBeGreaterThanOrEqual(headOf().getBoundingClientRect().bottom - 0.5);
      expect(row.bottom).toBeLessThanOrEqual(frameOf().getBoundingClientRect().bottom + 0.5);
    });
  });

  it("are guessed by a row's own height, not its details', before drawn", async () => {
    render(<Fruity open={["fruit 1"]} tall={500} />);
    await drawn();
    const row = ownRowOf("fruit 1").getBoundingClientRect().height;
    expect(frameOf().scrollHeight).toBeLessThan(40 * row + 500 + 100);
  });
});

describe("a list's row gone to", () => {
  it("comes to the top, below the header, focused and marked for a moment", async () => {
    const handle: RefObject<ListHandle | null> = { current: null };
    const flashed = vi.spyOn(Element.prototype, "animate");
    const many = Array.from({ length: 300 }, (_, at) => `fruit ${at + 1}`);
    render(<Fruity names={many} handle={handle} />);
    expect(handle.current?.goTo("fruit 250")).toBe(true);
    await waitFor(() => {
      const row = ownRowOf("fruit 250").getBoundingClientRect();
      expect(Math.abs(row.top - headOf().getBoundingClientRect().bottom)).toBeLessThan(1);
    });
    await waitFor(() => expect(focusedText()).toBe("fruit 250"));
    expect(flashed.mock.contexts.at(-1)).toBe(ownRowOf("fruit 250"));
    expect(handle.current?.goTo("no fruit")).toBe(false);
    flashed.mockRestore();
  });

  it("comes to the top and is marked, but leaves the focus where it is, if told so", async () => {
    const handle: RefObject<ListHandle | null> = { current: null };
    const flashed = vi.spyOn(Element.prototype, "animate");
    const many = Array.from({ length: 300 }, (_, at) => `fruit ${at + 1}`);
    render(<Fruity names={many} handle={handle} />);
    const away = document.body.appendChild(document.createElement("input"));
    away.focus();
    handle.current?.goTo("fruit 250", { focus: false });
    await waitFor(() => {
      const row = ownRowOf("fruit 250").getBoundingClientRect();
      expect(Math.abs(row.top - headOf().getBoundingClientRect().bottom)).toBeLessThan(1);
    });
    await waitFor(() => expect(flashed.mock.contexts.at(-1)).toBe(ownRowOf("fruit 250")));
    expect(document.activeElement).toBe(away);
    away.remove();
    flashed.mockRestore();
  });

  it("comes to the top with rows come before it on the way", async () => {
    const handle: RefObject<ListHandle | null> = { current: null };
    const many = Array.from({ length: 300 }, (_, at) => `fruit ${at + 1}`);
    const { rerender } = render(<Fruity names={many} handle={handle} />);
    handle.current?.goTo("fruit 250");
    const more = Array.from({ length: 5 }, (_, at) => `new ${at + 1}`);
    rerender(<Fruity names={[...more, ...many]} handle={handle} />); // tried again meanwhile
    await waitFor(() => expect(focusedText()).toBe("fruit 250"));
    await waitFor(() => {
      const row = ownRowOf("fruit 250").getBoundingClientRect();
      expect(Math.abs(row.top - headOf().getBoundingClientRect().bottom)).toBeLessThan(1);
    });
  });

  it("near the end, comes as far up as the list goes", async () => {
    const handle: RefObject<ListHandle | null> = { current: null };
    render(<Fruity handle={handle} />);
    handle.current?.goTo("fruit 39");
    await waitFor(() => expect(focusedText()).toBe("fruit 39"));
    const frame = frameOf();
    await waitFor(() =>
      expect(frame.scrollTop).toBeCloseTo(frame.scrollHeight - frame.clientHeight, 0),
    );
  });
});

describe("a list's band, below its header", () => {
  const bandOf = () => document.querySelector("[data-shown]") as HTMLElement | null;
  const boxOf = (element: Element | null | undefined) =>
    element?.firstElementChild?.getBoundingClientRect();

  it("shows once the rows scroll under the header, from the row at the top, a row high", async () => {
    render(<Fruity band />);
    await drawn();
    expect(bandOf()).toBeNull(); // at the top: the first row itself shows
    frameOf().scrollTop = 20; // past the room of the list above the header, which scrolls first
    await waitFor(() => expect(bandOf()).toHaveTextContent("below fruit 1"));
    const head = headOf().getBoundingClientRect();
    const row = ownRowOf("fruit 1").getBoundingClientRect();
    expect(boxOf(bandOf())?.top).toBeCloseTo(head.bottom, 0);
    expect(boxOf(bandOf())?.height).toBeCloseTo(row.height, 0);
    frameOf().scrollTop = 0;
    await waitFor(() => expect(bandOf()).toBeNull());
  });

  it("is told of the row coming in below it, how far down it starts, as it scrolls", async () => {
    render(<Fruity band />);
    const frame = frameOf();
    for (const by of [12, 18, 24]) {
      frame.scrollTop = by;
      await drawn();
      const band = boxOf(bandOf());
      const next = ownRowOf("fruit 2").getBoundingClientRect().top - (band?.top ?? 0);
      const said = Number(/fruit 2 at ([\d.]+)/.exec(bandOf()?.textContent ?? "")?.[1]);
      expect(bandOf()).toHaveTextContent(/^below fruit 1, fruit 2 at/);
      expect(said).toBeCloseTo(next, 0);
      const of = Number(/ of ([\d.]+)/.exec(bandOf()?.textContent ?? "")?.[1]);
      expect(of).toBeCloseTo(band?.height ?? 0, 0);
    }
  });

  it("stays on the row at the top as rows come before it, and moves on as that goes", async () => {
    const many = Array.from({ length: 100 }, (_, at) => `fruit ${at + 1}`);
    const { rerender } = render(<Fruity band names={many} />);
    frameOf().scrollTop = 200;
    await waitFor(() => expect(bandOf()).toHaveTextContent(/^below fruit \d+/));
    const top = /^below (fruit \d+)/.exec(bandOf()?.textContent ?? "")?.[1] ?? "";
    const more = Array.from({ length: 5 }, (_, at) => `new ${at + 1}`);
    rerender(<Fruity band names={[...more, ...many]} />); // e.g. new commits on top
    await drawn();
    expect(bandOf()).toHaveTextContent(new RegExp(`^below ${top}(,|$)`));
    rerender(<Fruity band names={[...more, ...many].filter((name) => name !== top)} />); // gone
    await drawn();
    expect(bandOf()).toHaveTextContent(/^below (new|fruit) \d+/);
    expect(bandOf()).not.toHaveTextContent(new RegExp(`^below ${top}(,|$)`));
  });

  it("in two lines, is a row's first line high, and rows gone to come below it", async () => {
    const handle: RefObject<ListHandle | null> = { current: null };
    render(<Fruity band layout="lines" handle={handle} />);
    handle.current?.goTo("fruit 20");
    await waitFor(() => expect(focusedText()).toBe("fruit 20"));
    await waitFor(() => expect(bandOf()).toHaveTextContent(/^below fruit 19$/));
    const band = boxOf(bandOf());
    const own = ownRowOf("fruit 20");
    const name = own.querySelector('[data-column="name"]')?.getBoundingClientRect();
    expect(own.getBoundingClientRect().top).toBeCloseTo(band?.bottom ?? 0, 0);
    // As high as the first line, with its room above and below: here the whole row, as no
    // fruit has a second.
    expect((name?.top ?? 0) - own.getBoundingClientRect().top).toBeGreaterThan(0);
    expect(band?.height ?? 0).toBeCloseTo(own.getBoundingClientRect().height, 0);
  });

  it("hides with the Panel it is in, as dockview hides those not shown", async () => {
    render(
      <div style={{ visibility: "hidden" }}>
        <Fruity band />
      </div>,
    );
    frameOf().scrollTop = 20;
    await waitFor(() => expect(bandOf()).toHaveTextContent("below fruit 1"));
    const banded = bandOf()?.firstElementChild as HTMLElement;
    expect(getComputedStyle(banded).visibility).toBe("hidden");
  });

  it("follows the row at the top, and has rows gone to come below it", async () => {
    const handle: RefObject<ListHandle | null> = { current: null };
    render(<Fruity band handle={handle} />);
    handle.current?.goTo("fruit 20");
    await waitFor(() => expect(focusedText()).toBe("fruit 20"));
    await waitFor(() => expect(bandOf()).toHaveTextContent(/^below fruit 19$/));
    const end = boxOf(bandOf())?.bottom ?? 0;
    expect(ownRowOf("fruit 20").getBoundingClientRect().top).toBeCloseTo(end, 0);
  });

  it("has the rows stuck come below it", async () => {
    render(<Fruity band open={["fruit 2"]} tall={400} />);
    await drawn();
    frameOf().scrollTop = 150; // in fruit 2's details
    await waitFor(() => expect(bandOf()).toHaveTextContent("below fruit 2"));
    const copy = screen
      .getAllByText("fruit 2")
      .find((text) => text.closest("[aria-hidden]") !== null && !bandOf()?.contains(text));
    const end = boxOf(bandOf())?.bottom ?? 0;
    await waitFor(() =>
      expect(copy?.closest("[role=row] > div")?.getBoundingClientRect().top).toBeCloseTo(end, 0),
    );
  });
});

describe("a list's rows as the list changes, as seen", () => {
  it("stay in place as rows above them go, the first in view too", async () => {
    const { rerender } = render(<Fruity />);
    frameOf().scrollTop = 200;
    await drawn();
    const before = ownRowOf("fruit 20").getBoundingClientRect().top;
    rerender(<Fruity names={FORTY.slice(3)} />);
    await drawn();
    expect(ownRowOf("fruit 20").getBoundingClientRect().top).toBeCloseTo(before, 0);
    const first = seenAt(headOf().getBoundingClientRect().bottom + 1)?.name ?? "";
    const next = ownRowOf(`fruit ${Number(first.split(" ")[1]) + 1}`).getBoundingClientRect().top;
    rerender(<Fruity names={FORTY.slice(3).filter((name) => name !== first)} />);
    await drawn();
    expect(seenAt(headOf().getBoundingClientRect().bottom + 1)?.name).not.toBe(first);
    expect(
      ownRowOf(`fruit ${Number(first.split(" ")[1]) + 1}`).getBoundingClientRect().top,
    ).toBeLessThan(next); // the next where the first was
  });

  it("keep the row focused, scrolled away, as rows come above", async () => {
    const { rerender } = render(<Growing ahead={0} />);
    await userEvent.tab();
    frameOf().scrollTop = 200;
    await drawn();
    const before = ownRowOf("fruit 20").getBoundingClientRect().top;
    rerender(<Growing ahead={5} />);
    await drawn();
    expect(ownRowOf("fruit 1").parentElement).toHaveFocus();
    expect(ownRowOf("fruit 20").getBoundingClientRect().top).toBeCloseTo(before, 0);
  });

  it("keep the first row in view, in view, as the layout changes", async () => {
    const { rerender } = render(<Fruity layout="columns" />);
    frameOf().scrollTop = 200;
    await drawn();
    const first = seenAt(headOf().getBoundingClientRect().bottom + 1)?.name ?? "";
    rerender(<Fruity layout="lines" />);
    await drawn();
    await drawn();
    const row = ownRowOf(first).getBoundingClientRect();
    expect(row.bottom).toBeGreaterThan(headOf().getBoundingClientRect().bottom);
    expect(row.top).toBeLessThan(frameOf().getBoundingClientRect().bottom);
  });

  it("keep their place as rows come while hidden, shown again", async () => {
    const { rerender } = render(<Growing ahead={0} />);
    frameOf().scrollTop = 200;
    await drawn();
    const before = ownRowOf("fruit 20").getBoundingClientRect().top;
    const panel = frameOf().parentElement as HTMLElement;
    panel.style.visibility = "hidden";
    rerender(<Growing ahead={5} />);
    await drawn();
    panel.style.visibility = "";
    await drawn();
    expect(ownRowOf("fruit 20").getBoundingClientRect().top).toBeCloseTo(before, 0);
  });
});

describe("a list's rows stuck, as the list changes", () => {
  it("lie below the header where its height changes, without a draw", async () => {
    render(<Fruity open={["fruit 1"]} tall={600} />);
    frameOf().scrollTop = 200;
    await drawn();
    headOf().style.paddingTop = "20px"; // as its buttons wrap, narrowed
    await waitFor(() => {
      const copy = document.querySelector("[aria-hidden] [role=row]")?.getBoundingClientRect();
      expect(copy?.top).toBeCloseTo(headOf().getBoundingClientRect().bottom, 0);
    });
  });

  it("lie at the list's top without a header, as in two lines without filters", async () => {
    render(<Fruity layout="lines" open={["fruit 1"]} tall={600} />);
    expect(headOf().getBoundingClientRect().height).toBe(0);
    frameOf().scrollTop = 200;
    await drawn();
    const copy = document.querySelector("[aria-hidden] [role=row]")?.getBoundingClientRect();
    expect(copy?.top).toBeCloseTo(frameOf().getBoundingClientRect().top, 0);
  });

  it("move as details grow while stuck, without a scroll", async () => {
    const { rerender } = render(<Fruity open={["fruit 1"]} tall={300} />);
    await drawn();
    // The end of its details reaching it: sliding out, the next row just below the header.
    frameOf().scrollTop +=
      ownRowOf("fruit 2").getBoundingClientRect().top -
      headOf().getBoundingClientRect().bottom -
      10;
    await drawn();
    const sliding = document.querySelector("[aria-hidden] [role=row]")?.getBoundingClientRect();
    expect(sliding?.top).toBeLessThan(headOf().getBoundingClientRect().bottom - 1);
    rerender(<Fruity open={["fruit 1"]} tall={600} />);
    await waitFor(() => {
      const copy = document.querySelector("[aria-hidden] [role=row]")?.getBoundingClientRect();
      expect(copy?.top).toBeCloseTo(headOf().getBoundingClientRect().bottom, 0);
    });
  });
});

describe("a row's copy stuck, toned", () => {
  // Its chevron, an alarm's, in the background's colour, seen only on the tint.
  it("has its square tinted as the row has", async () => {
    render(
      <Fruity
        open={["fruit 1"]}
        tall={400}
        tone={(name) => (name === "fruit 1" ? "alarm" : undefined)}
      />,
    );
    const square = (row: HTMLElement) => getComputedStyle(row).backgroundImage;
    const own = square(ownRowOf("fruit 1").parentElement as HTMLElement);
    expect(own).toContain("linear-gradient");
    frameOf().scrollTop = 100;
    const copy = await waitFor(() => {
      const found = frameOf().querySelector<HTMLElement>("[aria-hidden=true] [role=row] > div");
      if (!found) throw new Error("no copy yet");
      return found;
    });
    expect(square(copy)).toContain(own.slice(0, own.indexOf(")") + 1)); // the tint's first stop
  });
});

describe("a row's square, clicked", () => {
  it("opens it and focuses the row, so that the keys go on from it", async () => {
    render(<Fruity />);
    await pointer.click(ownRowOf("fruit 1").querySelector("button") as HTMLElement);
    expect(await screen.findByText("All about fruit 1")).toBeInTheDocument();
    expect(ownRowOf("fruit 1").parentElement).toHaveFocus();
    await pointer.keyboard("{ArrowDown}");
    expect(ownRowOf("fruit 2").parentElement).toHaveFocus();
  });
});

describe("a row's details, clicked within", () => {
  it("leave the keys to scroll the list, not to act on the row, but for Escape", async () => {
    render(<Fruity open={["fruit 1"]} tall={600} />);
    await pointer.click(screen.getByText("All about fruit 1"));
    await pointer.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
    await waitFor(() => expect(frameOf().scrollTop).toBeGreaterThan(0));
    expect(ownRowOf("fruit 2").parentElement).not.toHaveFocus();
    await pointer.keyboard(" ");
    expect(screen.getByText("All about fruit 1")).toBeInTheDocument();
    await pointer.keyboard("{Escape}");
    expect(screen.queryByText("All about fruit 1")).not.toBeInTheDocument();
    expect(ownRowOf("fruit 1").parentElement).toHaveFocus();
  });
});
