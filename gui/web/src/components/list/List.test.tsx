import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { listRows } from "../../test/list";
import { Chevron, List } from "./List";
import { listColumnHelper, useList } from "./table";

interface Fruit {
  name: string;
}

const column = listColumnHelper<Fruit>();

/** Fruits, each with a button of its own in the middle of its row. */
function Fruits({ act }: { act: (fruit: Fruit) => void }) {
  const columns = column.columns([
    column.display({ id: "square", cell: Chevron }),
    column.display({
      id: "act",
      cell: ({ row }) => (
        <button type="button" onClick={() => act(row.original)}>
          Peel
        </button>
      ),
    }),
    column.accessor("name", { header: "name", meta: { description: "What it is called" } }),
  ]);
  const table = useList("fruits", "columns", {
    columns,
    data: [{ name: "apple" }, { name: "pear" }],
  });
  return (
    <List
      table={table}
      label="Fruits"
      layout="columns"
      choices={{}}
      message={null}
      older="fruits"
      squareTitle={(fruit) => `${fruit.name} square`}
      detailsLabel="Fruit details"
      details={(fruit) => `ripe ${fruit.name}`}
    />
  );
}

describe("a list's rows", () => {
  it("open by a button named by the row, while their cells' buttons act on their own", async () => {
    const act = vi.fn();
    render(<Fruits act={act} />);
    const pear = screen.getByRole("button", { name: /pear$/ });
    await userEvent.click(screen.getAllByRole("button", { name: "Peel" })[1] as HTMLElement);
    expect(act).toHaveBeenCalledWith({ name: "pear" });
    expect(pear).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(pear);
    expect(pear).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("region", { name: "Fruit details" })).toHaveTextContent("ripe pear");
  });

  it("open by a click anywhere else, but not one selecting text", async () => {
    render(<Fruits act={vi.fn()} />);
    const pear = screen.getByRole("button", { name: /pear$/ });
    const name = screen.getByText("pear");
    await userEvent.click(name);
    expect(pear).toHaveAttribute("aria-expanded", "true");
    document.getSelection()?.selectAllChildren(name);
    fireEvent.click(name, { detail: 1 }); // ending a selection by dragging
    expect(pear).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(name, { detail: 2 }); // a double click's second, selecting a word
    expect(pear).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(name, { detail: 3 }); // selecting the line
    expect(pear).toHaveAttribute("aria-expanded", "false");
  });

  it("show their own tooltips: that of the square, and the whole text of cells", () => {
    render(<Fruits act={vi.fn()} />);
    expect(screen.getByRole("button", { name: /pear$/ })).toHaveAttribute("title", "pear square");
    const cell = screen.getByText("pear");
    fireEvent.pointerOver(cell);
    expect(cell).toHaveAttribute("title", "pear");
  });

  it("say what their columns show, if their labels do not", () => {
    render(<Fruits act={vi.fn()} />);
    expect(screen.getByText("name")).toHaveAttribute("title", "What it is called");
  });
});

interface Node {
  name: string;
  subRows: Node[];
}

const node = listColumnHelper<Node>();
const TREE: Node[] = [
  {
    name: "src",
    subRows: [
      { name: "b.py", subRows: [] },
      { name: "a.py", subRows: [] },
    ],
  },
  { name: "README", subRows: [] },
];

/** A tree of files, its folders folding, each row with a menu. */
function Tree({ embedded = false, act }: { embedded?: boolean; act?: (name: string) => void }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const columns = node.columns([
    node.display({ id: "square", cell: Chevron }),
    node.accessor("name", { header: "name", meta: { identifies: true } }),
  ]);
  const table = useList("tree", "columns", {
    columns,
    data: TREE,
    getRowId: (row) => row.name,
    getSubRows: (row) => row.subRows,
    getRowCanExpand: (row) => row.original.subRows.length > 0,
    state: { expanded },
    onExpandedChange: (change) =>
      setExpanded((was) => (typeof change === "function" ? change(was) : change) as typeof was),
  });
  return (
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
      plain={(row) => row.subRows.length === 0}
      menu={(row) => ({
        label: `Actions on ${row.name}`,
        groups: [
          [
            { id: "copy", label: "Copy", icon: Copy, onAction: () => act?.(row.name) },
            { id: "again", label: "Again", icon: Copy, onAction: () => {} },
          ],
        ],
      })}
    />
  );
}

/** A row's own item: the `li` whose row says `name`. */
const itemOf = (name: string) => screen.getByText(name).closest("[role=row]") as HTMLElement;

describe("a list as a tree", () => {
  it("draws a row's rows after it, in order, holding them only while open", async () => {
    render(<Tree />);
    expect(itemOf("src")).not.toHaveAttribute("data-holding");
    await userEvent.click(screen.getByText("src"));
    const items = listRows().map((item) => item.textContent);
    expect(items.slice(items.indexOf("src"), -1)).toEqual(["src", "b.py", "a.py"]); // as given
    expect(itemOf("src")).toHaveAttribute("data-holding");
    expect(itemOf("a.py")).toHaveAttribute("data-depth", "1");
    await userEvent.click(screen.getByText("src"));
    expect(screen.queryByText("a.py")).toBeNull();
    expect(itemOf("src")).not.toHaveAttribute("data-holding");
  });

  it("opens a row's menu by the keyboard on its first item, which acts without folding it", async () => {
    const act = vi.fn();
    render(<Tree act={act} />);
    const src = screen.getByText("src").closest("[id]") as HTMLElement;
    fireEvent.contextMenu(src, { clientX: 0, clientY: 0 }); // the menu key
    const menu = await screen.findByRole("menu", { name: "Actions on src" });
    expect(within(menu).getAllByRole("menuitem")[0]).toHaveFocus();
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Copy" }));
    expect(act).toHaveBeenCalledWith("src");
    expect(screen.queryByText("a.py")).toBeNull(); // not opened by the click
  });
});

describe("a list, for screen readers", () => {
  it("is a treegrid: its header a row of column headers, its rows by level and place", async () => {
    render(<Tree />);
    const grid = screen.getByRole("treegrid", { name: "Files" }); // named by its View
    expect(grid).toHaveAttribute("aria-rowcount", "3"); // the header, src and README
    const [head, src, readme] = screen.getAllByRole("row");
    expect(head).toHaveAttribute("aria-rowindex", "1");
    expect(within(head as HTMLElement).getByRole("columnheader", { name: "name" })).toBeVisible();
    expect(src).toHaveAttribute("aria-expanded", "false");
    expect(readme).not.toHaveAttribute("aria-expanded"); // it opens nothing
    expect(readme).toHaveAttribute("aria-posinset", "2");
    await userEvent.click(screen.getByText("src"));
    expect(grid).toHaveAttribute("aria-rowcount", "5");
    const a = itemOf("a.py");
    expect(itemOf("src")).toHaveAttribute("aria-expanded", "true");
    expect(a).toHaveAttribute("aria-level", "2");
    expect(a).toHaveAttribute("aria-rowindex", "4");
    expect(a).toHaveAttribute("aria-posinset", "2");
    expect(a).toHaveAttribute("aria-setsize", "2");
  });

  it("names a row's details, in a cell below its own", async () => {
    render(<Fruits act={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /pear$/ }));
    const details = screen.getByRole("region", { name: "Fruit details" });
    expect(details.closest("[role=gridcell]")?.closest("[role=row]")).toHaveTextContent("pear");
  });
});

/** Fruits as given, each opening its details, a button of its own in its row, and a menu. */
function Basket({ fruits }: { fruits: string[] }) {
  const columns = column.columns([
    column.display({ id: "square", cell: Chevron }),
    column.display({ id: "act", cell: () => <button type="button">Peel</button> }),
    column.display({
      id: "weigh",
      cell: () => (
        <a href="#weigh" tabIndex={0}>
          Weigh
        </a>
      ),
    }), // its own tabindex
    column.accessor("name", { header: "name" }),
  ]);
  const table = useList("basket", "columns", {
    columns,
    data: fruits.map((name) => ({ name })),
    getRowId: (fruit) => fruit.name,
  });
  return (
    <List
      table={table}
      label="Fruits"
      layout="columns"
      choices={{}}
      message={null}
      older="fruits"
      detailsLabel="Fruit details"
      details={(fruit) => <button type="button">Eat the {fruit.name}</button>}
      menu={(fruit) => ({
        label: `Actions on ${fruit.name}`,
        groups: [[{ id: "copy", label: "Copy", icon: Copy, onAction: () => {} }]],
      })}
    />
  );
}

/** The tree of files, its folder open or closed from outside, as by a live update. */
function Folder({ open }: { open: boolean }) {
  const columns = node.columns([
    node.display({ id: "square", cell: Chevron }),
    node.accessor("name", { header: "name" }),
  ]);
  const table = useList("folder", "columns", {
    columns,
    data: TREE,
    getRowId: (row) => row.name,
    getSubRows: (row) => row.subRows,
    getRowCanExpand: (row) => row.original.subRows.length > 0,
    state: { expanded: { src: open } },
  });
  return (
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
  );
}

describe("a list, by the keys", () => {
  it("is one stop of Tab, at its first row, then what that row holds, not the others'", async () => {
    render(<Basket fruits={["apple", "pear"]} />);
    await userEvent.tab();
    expect(itemOf("apple")).toHaveFocus();
    await userEvent.tab();
    expect(within(itemOf("apple")).getByRole("button", { name: "Peel" })).toHaveFocus();
    await userEvent.tab();
    expect(within(itemOf("apple")).getByText("Weigh")).toHaveFocus(); // its own tabindex kept
    await userEvent.tab();
    expect(document.body).toHaveFocus(); // out of the list, past pear's
    await userEvent.tab({ shift: true });
    expect(within(itemOf("apple")).getByText("Weigh")).toHaveFocus();
  });

  it("moves between rows up and down, to the first and the last, the row focused selected", async () => {
    render(<Basket fruits={["apple", "pear", "plum"]} />);
    await userEvent.tab();
    await userEvent.keyboard("{ArrowDown}");
    expect(itemOf("pear")).toHaveFocus();
    expect(itemOf("pear")).toHaveAttribute("aria-selected", "true");
    expect(itemOf("apple")).toHaveAttribute("aria-selected", "false");
    await userEvent.keyboard("{End}");
    expect(itemOf("plum")).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}"); // stays at the last
    expect(itemOf("plum")).toHaveFocus();
    await userEvent.keyboard("{Home}{ArrowUp}");
    expect(itemOf("apple")).toHaveFocus();
    await userEvent.tab();
    await userEvent.tab({ shift: true }); // back to the row focused, not the first
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.tab({ shift: true });
    await userEvent.tab();
    expect(itemOf("pear")).toHaveFocus();
  });

  it("unfolds a row by the right, goes into it, out by the left, and folds it", async () => {
    render(<Tree />);
    await userEvent.tab();
    expect(itemOf("src")).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    expect(itemOf("src")).toHaveAttribute("aria-expanded", "true");
    await userEvent.keyboard("{ArrowRight}");
    expect(itemOf("b.py")).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(itemOf("src")).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.queryByText("b.py")).toBeNull();
  });

  it("opens a row by Enter or Space, and closes its details by Escape, also from within", async () => {
    render(<Basket fruits={["apple", "pear"]} />);
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    expect(itemOf("apple")).toHaveAttribute("aria-expanded", "true");
    await userEvent.keyboard("{Escape}");
    expect(itemOf("apple")).toHaveAttribute("aria-expanded", "false");
    await userEvent.keyboard(" ");
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab(); // into its details
    expect(screen.getByRole("button", { name: "Eat the apple" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(itemOf("apple")).toHaveAttribute("aria-expanded", "false");
    expect(itemOf("apple")).toHaveFocus();
  });

  it("focuses the row holding the row focused once that goes, else the row at its place", async () => {
    const { rerender } = render(<Folder open />);
    await userEvent.tab();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(itemOf("a.py")).toHaveFocus();
    rerender(<Folder open={false} />);
    expect(itemOf("src")).toHaveFocus();

    const { rerender: again } = render(<Basket fruits={["fig", "kiwi", "lime"]} />);
    await userEvent.click(screen.getByText("kiwi"));
    again(<Basket fruits={["fig", "lime"]} />);
    expect(itemOf("lime")).toHaveAttribute("aria-selected", "true");
  });

  it("opens a row's menu by the menu key on the row focused", async () => {
    const act = vi.fn();
    render(<Tree act={act} />);
    await userEvent.tab();
    fireEvent.contextMenu(itemOf("src"), { clientX: 0, clientY: 0 }); // the menu key
    const menu = await screen.findByRole("menu", { name: "Actions on src" });
    expect(within(menu).getAllByRole("menuitem")[0]).toHaveFocus();
  });

  it("opens a row's menu on the row, not in its details, which keep the browser's", async () => {
    render(<Basket fruits={["apple"]} />);
    await userEvent.click(screen.getByText("apple"));
    const eat = screen.getByRole("button", { name: "Eat the apple" });
    expect(fireEvent.contextMenu(eat)).toBe(true); // not prevented
    expect(screen.queryByRole("menu")).toBeNull();
    expect(fireEvent.contextMenu(screen.getByText("apple"))).toBe(false);
    expect(await screen.findByRole("menu", { name: "Actions on apple" })).toBeVisible();
  });

  it("leaves the focus where a click took it out of the list, as rows change", async () => {
    const { rerender } = render(<Basket fruits={["apple", "pear"]} />);
    await userEvent.tab();
    fireEvent.blur(itemOf("apple"), { relatedTarget: null }); // a click on nothing to focus
    (document.activeElement as HTMLElement).blur();
    rerender(<Basket fruits={["apple", "pear", "plum"]} />);
    expect(document.body).toHaveFocus();
  });

  it("leaves the arrows with Alt to the Group, back and forward, the row as it is", async () => {
    render(<Basket fruits={["apple", "pear"]} />);
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    expect(fireEvent.keyDown(itemOf("apple"), { key: "ArrowLeft", altKey: true })).toBe(true);
    expect(itemOf("apple")).toHaveAttribute("aria-expanded", "true");
    expect(fireEvent.keyDown(itemOf("apple"), { key: "ArrowDown", altKey: true })).toBe(true);
    expect(itemOf("apple")).toHaveFocus();
  });

  it("leaves to the page the keys that do nothing on the row", async () => {
    render(<Basket fruits={["apple"]} />);
    await userEvent.tab();
    for (const key of ["Escape", "ArrowLeft", "ArrowUp", "Home", "End"]) {
      expect(fireEvent.keyDown(itemOf("apple"), { key }), key).toBe(true); // not prevented
    }
    expect(fireEvent.keyDown(itemOf("apple"), { key: "ArrowRight" })).toBe(false); // it opens
  });

  it("keeps the row focused as sorting moves it, the keys following the new order", async () => {
    const { rerender } = render(<Basket fruits={["apple", "fig", "pear"]} />);
    await userEvent.click(screen.getByText("fig"));
    rerender(<Basket fruits={["pear", "fig", "apple"]} />); // as sorted the other way
    expect(itemOf("fig")).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{ArrowDown}");
    expect(itemOf("apple")).toHaveFocus();
  });

  it("enters at the first row once rows come back, all of them gone before", async () => {
    const { rerender } = render(<Basket fruits={["apple", "pear"]} />);
    await userEvent.click(screen.getByText("pear"));
    rerender(<Basket fruits={[]} />);
    rerender(<Basket fruits={["fig", "kiwi"]} />);
    (document.activeElement as HTMLElement | null)?.blur();
    await userEvent.tab();
    expect(itemOf("fig")).toHaveFocus();
  });

  it("leaves out of Tab what comes into another row later, e.g. a diff once drawn", async () => {
    render(<Late />);
    await userEvent.click(screen.getByText("pear")); // its details open, and the row focused
    await userEvent.keyboard("{ArrowUp}");
    await screen.findByRole("button", { name: "Show the pear" }); // come in later
    await new Promise((done) => requestAnimationFrame(() => done(null)));
    await userEvent.tab();
    expect(document.body).toHaveFocus(); // apple holds nothing, pear's left out
  });
});

/** Two fruits whose details show a button only a while after they open, as a diff does. */
function Late() {
  const columns = column.columns([
    column.display({ id: "square", cell: Chevron }),
    column.accessor("name", { header: "name" }),
  ]);
  const table = useList("late", "columns", {
    columns,
    data: [{ name: "apple" }, { name: "pear" }],
    getRowId: (fruit) => fruit.name,
  });
  return (
    <List
      table={table}
      label="Fruits"
      layout="columns"
      choices={{}}
      message={null}
      older="fruits"
      detailsLabel="Fruit details"
      details={(fruit) => <Later name={fruit.name} />}
    />
  );
}

function Later({ name }: { name: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), 50);
    return () => clearTimeout(timer);
  }, []);
  return shown ? <button type="button">Show the {name}</button> : null;
}
