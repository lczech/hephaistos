import type { ColumnFiltersState, SortingState } from "@tanstack/react-table";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Chevron, ListTable } from "./ListTable";
import { listColumnHelper, useListTable } from "./list";

interface Fruit {
  name: string;
  taste: string;
  weight: number;
}

const column = listColumnHelper<Fruit>();
const columns = column.columns([
  column.display({ id: "ripeness", cell: Chevron, meta: { filter: { param: "ripeness" } } }),
  column.accessor("name", { header: "name", enableSorting: true }),
  column.accessor("taste", {
    header: "taste",
    meta: { filter: { param: "taste", many: "tastes" } },
  }),
  column.accessor("weight", { header: "weight", enableSorting: true, sortDescFirst: true }),
]);

const fruits = [
  { name: "apple", taste: "sweet", weight: 150 },
  { name: "lemon", taste: "sour", weight: 100 },
  { name: "pear", taste: "sweet", weight: 180 },
];

/** Fruits in two lines, filtered and sorted as chosen. */
function Fruits() {
  const [filters, setFilters] = useState<ColumnFiltersState>([]);
  const [sorting, setSorting] = useState<SortingState>([{ id: "name", desc: false }]);
  const table = useListTable("fruits", "lines", {
    columns,
    data: fruits,
    manualFiltering: true,
    enableSortingRemoval: false,
    state: { columnFilters: filters, sorting },
    onColumnFiltersChange: (change) =>
      setFilters(typeof change === "function" ? change(filters) : change),
    onSortingChange: (change) =>
      setSorting(typeof change === "function" ? change(sorting) : change),
  });
  return (
    <>
      <ListTable
        table={table}
        layout="lines"
        choices={{
          ripeness: [{ value: "ripe", label: "ripe" }],
          taste: [
            { value: "sweet", label: "sweet" },
            { value: "sour", label: "sour" },
          ],
        }}
        message={null}
        older="fruits"
        detailsLabel="Fruit details"
        details={(fruit) => fruit.name}
      />
      <output>{JSON.stringify({ filters, sorting })}</output>
    </>
  );
}

const button = (name: string | RegExp) => screen.getByRole("button", { name });
const state = () => JSON.parse(screen.getByRole("status").textContent ?? "{}");
const names = () =>
  [...document.querySelectorAll("ol [data-column='name']")].map((cell) => cell.textContent);

describe("a list's header in two lines", () => {
  it("has a button for each filter, the square's by its name, saying what it is set to", async () => {
    render(<Fruits />);
    expect(screen.queryByRole("columnheader")).toBeNull();
    await userEvent.click(button("ripeness"));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "ripe" }));
    expect(button("ripeness: ripe")).toHaveAttribute("data-filtered");
    await userEvent.click(button("taste"));
    await userEvent.click(screen.getByRole("button", { name: "Only sour" }));
    await userEvent.keyboard("{Escape}");
    expect(button("taste: sour")).toBeInTheDocument();
    expect(state().filters).toEqual([
      { id: "ripeness", value: ["ripe"] },
      { id: "taste", value: ["sour"] },
    ]);
  });

  it("clears all filters by one button, there only while any is set", async () => {
    render(<Fruits />);
    expect(screen.queryByRole("button", { name: "Clear all filters" })).toBeNull();
    await userEvent.click(button("ripeness"));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "ripe" }));
    await userEvent.click(button("Clear all filters"));
    expect(state().filters).toEqual([]);
    expect(screen.queryByRole("button", { name: "Clear all filters" })).toBeNull();
  });

  it("sorts by the column chosen, as its header first would, and turns round by its arrow", async () => {
    render(<Fruits />);
    expect(names()).toEqual(["apple", "lemon", "pear"]);
    await userEvent.click(button("sorted by name"));
    expect(screen.getByRole("menuitemradio", { name: "name" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await userEvent.click(screen.getByRole("menuitemradio", { name: "weight" }));
    expect(state().sorting).toEqual([{ id: "weight", desc: true }]); // heaviest first
    expect(names()).toEqual(["pear", "apple", "lemon"]);
    await userEvent.click(button("Sort ascending"));
    expect(state().sorting).toEqual([{ id: "weight", desc: false }]);
    expect(button("Sort descending")).toHaveAttribute(
      "title",
      "Sorted ascending; click to sort descending",
    );
  });
});
