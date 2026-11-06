import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Copy } from "lucide-react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
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
const itemOf = (name: string) => screen.getByText(name).closest("li") as HTMLElement;

describe("a list as a tree", () => {
  it("draws a row's rows within its item, in order, holding them only while open", async () => {
    render(<Tree />);
    expect(itemOf("src")).not.toHaveAttribute("data-holding");
    await userEvent.click(screen.getByText("src"));
    const inner = within(itemOf("src")).getAllByRole("listitem");
    expect(inner.map((item) => item.textContent)).toEqual(["b.py", "a.py"]); // as given
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
