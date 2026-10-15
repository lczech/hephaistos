import { render, screen } from "@testing-library/react";
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
    column.accessor("name", { header: "name" }),
  ]);
  const table = useListTable({ columns, data: [{ name: "apple" }, { name: "pear" }] });
  return (
    <ListTable
      table={table}
      choices={{}}
      message={null}
      older="fruits"
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
});
