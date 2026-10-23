import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Chevron, ListTable } from "./ListTable";
import { listColumnHelper, useListTable } from "./list";

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
  const table = useListTable({ columns, data: FRUITS });
  return (
    <div style={{ height: 200, overflow: "auto" }}>
      <ListTable
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
