import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ListLayout } from "./kept";
import { Chevron, List } from "./List";
import { listColumnHelper, useList } from "./table";

interface Fruit {
  name: string;
}

const column = listColumnHelper<Fruit>();
const FRUITS = Array.from({ length: 40 }, (_, at) => ({ name: `fruit ${at + 1}` }));

/** Fruits in a Panel as high as a few of them, more of them to load. */
function Fruits({ fetchNextPage }: { fetchNextPage: () => void }) {
  const columns = column.columns([
    column.display({ id: "square", cell: Chevron }),
    column.accessor("name", { header: "name" }),
  ]);
  const table = useList("fruits", "columns", { columns, data: FRUITS });
  return (
    <div style={{ height: 200, overflow: "auto" }}>
      <List
        table={table}
        layout="columns"
        choices={{}}
        message={null}
        paging={{ hasNextPage: true, isFetchingNextPage: false, fetchNextPage }}
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

  it("fits it to a cell out of view too, never drawn", async () => {
    render(<Long name="a rather long name for a fruit" width={800} after={300} />);
    const cell = screen.getByText("a rather long name for a fruit");
    fitName();
    await waitFor(() => expect(nameWidth()).toBeGreaterThan(100));
    cell.scrollIntoView();
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
    const drawn = (name: string) =>
      screen.getByText(name).checkVisibility({ contentVisibilityAuto: true });
    await waitFor(() => expect(drawn("fruit 1")).toBe(true));
    expect(drawn("last")).toBe(false);
    screen.getByText("last").scrollIntoView();
    await waitFor(() => expect(drawn("last")).toBe(true));
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
      .filter((cell) => cell.closest("ol") === null)
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
    frame.scrollTop = frame.scrollHeight; // its last rows in view, "src" stuck above them
    await waitFor(() => expect(rowOf("file 5").getBoundingClientRect().bottom).toBeLessThan(0));
    within(rowOf("file 5")).getByRole("button").focus(); // as Shift+Tab moves up to it
    await waitFor(() =>
      expect(rowOf("file 5").getBoundingClientRect().top).toBeGreaterThanOrEqual(
        rowOf("src").getBoundingClientRect().bottom - 1,
      ),
    );
  });

  it("lines up the rows within a row below the headers too", () => {
    render(<Tree />);
    const [header, ...cells] = document.querySelectorAll('[data-column="name"]');
    const left = (at: Element | undefined) => at?.getBoundingClientRect().left ?? Number.NaN;
    expect(cells.length).toBeGreaterThan(1);
    for (const cell of cells) expect(left(cell)).toBeCloseTo(left(header), 1);
  });

  it("sticks an open row, still marked as shown, unless part of a page", () => {
    const { unmount } = render(<Tree />);
    const stuck = getComputedStyle(rowOf("src"));
    expect(stuck.position).toBe("sticky");
    expect(stuck.backgroundImage).toMatch(/gradient/); // its mark, over the page's colour
    unmount();
    render(<Tree embedded />);
    expect(getComputedStyle(rowOf("src")).position).not.toBe("sticky");
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
      const [src, inner] = [rowOf("src"), rowOf("inner")].map((row) => row.getBoundingClientRect());
      expect(src?.top).toBeCloseTo(head.getBoundingClientRect().bottom, 0);
      expect(inner?.top).toBeCloseTo(src?.bottom ?? 0, 0);
    });
  });
});
