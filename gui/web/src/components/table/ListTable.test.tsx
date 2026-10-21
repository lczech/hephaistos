import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Chevron, ListTable } from "./ListTable";
import { listColumnHelper, useListTable } from "./list";

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
  const table = useListTable({ columns, data: [{ name: "apple" }, { name: "pear" }] });
  return (
    <ListTable
      table={table}
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

  it("show their own tooltips: the square's, and cells' whole text", () => {
    render(<Fruits act={vi.fn()} />);
    expect(screen.getByRole("button", { name: /pear$/ })).toHaveAttribute("title", "pear square");
    const cell = screen.getByText("pear");
    fireEvent.pointerOver(cell);
    expect(cell).toHaveAttribute("title", "pear");
  });

  it("say what their columns show, if their labels don't", () => {
    render(<Fruits act={vi.fn()} />);
    expect(screen.getByText("name")).toHaveAttribute("title", "What it is called");
  });
});
