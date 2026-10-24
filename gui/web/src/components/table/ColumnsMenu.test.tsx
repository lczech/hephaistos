import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { ListLayout } from "./kept";
import { Chevron, ListTable } from "./ListTable";
import { listColumnHelper, useListTable } from "./list";

interface Fruit {
  name: string;
  colour: string;
  taste: string;
}

const column = listColumnHelper<Fruit>();
const columns = column.columns([
  column.display({ id: "square", cell: Chevron, meta: { width: "var(--square)" } }),
  column.accessor("name", { header: "name", meta: { identifies: true } }),
  column.accessor("colour", { header: "colour" }),
  column.accessor("taste", { header: "taste" }),
]);

/** Fruits in a list, filtered by taste or not. */
function Fruits({ layout = "columns", taste }: { layout?: ListLayout; taste?: string }) {
  const table = useListTable("fruits", layout, {
    columns,
    data: [{ name: "apple", colour: "red", taste: "sweet" }],
    manualFiltering: true,
    state: { columnFilters: taste === undefined ? [] : [{ id: "taste", value: [taste] }] },
  });
  return (
    <ListTable
      table={table}
      layout={layout}
      choices={{}}
      message={null}
      older="fruits"
      detailsLabel="Fruit details"
      details={(fruit) => fruit.name}
    />
  );
}

const headers = () =>
  [...document.querySelectorAll("[data-column]")]
    .filter((cell) => cell.closest("ol") === null)
    .map((cell) => cell.getAttribute("data-column"));

const openMenu = (label: string) =>
  fireEvent.contextMenu(screen.getByText(new RegExp(`^${label}`)));

const item = (name: string | RegExp) => screen.getByRole("menuitemcheckbox", { name });

describe("a list's header menu", () => {
  it("hides and shows columns, but not the one saying what a row is, keeping it so", async () => {
    render(<Fruits />);
    openMenu("colour");
    expect(item("name")).toHaveAttribute("aria-disabled", "true");
    expect(item("colour")).toHaveAttribute("aria-checked", "true");
    await userEvent.click(item("colour"));
    expect(item("colour")).toHaveAttribute("aria-checked", "false");
    expect(headers()).toEqual(["square", "name", "taste"]);
    expect(screen.queryByText("red")).toBeNull();
    expect(localStorage.getItem("hephaistos.lists.fruits.hidden")).toBe('["colour"]');
    await userEvent.click(item("colour"));
    expect(headers()).toEqual(["square", "name", "colour", "taste"]);
  });

  it("shows a column filtered by, hidden or not, until the filter is cleared", () => {
    localStorage.setItem("hephaistos.lists.fruits.hidden", '["taste"]');
    const { rerender } = render(<Fruits taste="sweet" />);
    expect(headers()).toContain("taste");
    openMenu("taste");
    expect(item("taste")).toHaveAttribute("aria-disabled", "true");
    rerender(<Fruits />);
    expect(headers()).not.toContain("taste");
  });

  it("moves the column clicked past those shown, the fixed ones staying", async () => {
    localStorage.setItem("hephaistos.lists.fruits.hidden", '["colour"]');
    render(<Fruits />);
    openMenu("taste");
    const right = screen.getByRole("menuitem", { name: 'Move "taste" right' });
    expect(right).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(screen.getByRole("menuitem", { name: 'Move "taste" left' }));
    expect(headers()).toEqual(["square", "taste", "name"]);
    expect(localStorage.getItem("hephaistos.lists.fruits.order")).toBe('["taste","name","colour"]');
  });

  it("offers no moves for a fixed part, and resets the list's look", async () => {
    localStorage.setItem("hephaistos.lists.fruits.hidden", '["colour"]');
    localStorage.setItem("hephaistos.lists.fruits.order", '["taste","name","colour"]');
    localStorage.setItem("hephaistos.lists.fruits.widths", '{"name":90}');
    localStorage.setItem("hephaistos.lists.fruits.layout", '"columns"');
    render(<Fruits />);
    const square = document.querySelector('[data-column="square"]') as HTMLElement;
    fireEvent.contextMenu(square);
    const menu = screen.getByRole("menu", { name: "Columns" });
    expect(within(menu).queryByRole("menuitem", { name: /^Move/ })).toBeNull();
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Reset columns" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(headers()).toEqual(["square", "name", "colour", "taste"]);
    expect(localStorage.getItem("hephaistos.lists.fruits.widths")).toBe("{}");
    expect(localStorage.getItem("hephaistos.lists.fruits.layout")).toBe("null");
  });

  it("is only for columns: in two lines, the View places the cells", () => {
    localStorage.setItem("hephaistos.lists.fruits.hidden", '["colour"]');
    render(<Fruits layout="lines" />);
    expect(screen.getByText("red")).toBeInTheDocument();
    openMenu("taste");
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
