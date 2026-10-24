import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  const table = useListTable("fruits", "columns", { columns, data: FRUITS });
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

/** A fruit with a long name, in a list this wide. */
function Long({ name, width }: { name: string; width: number }) {
  const columns = column.columns([
    column.display({ id: "square", cell: Chevron, meta: { width: "var(--square)" } }),
    column.accessor("name", { header: "name", size: 60 }),
  ]);
  const table = useListTable("long", "columns", { columns, data: [{ name }] });
  return (
    <div style={{ width, height: 200, display: "flex", flexDirection: "column" }}>
      <ListTable
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
  const table = useListTable("coloured", "columns", { columns, data: [{ name: "apple" }] });
  return (
    <div style={{ width: 600, height: 200, display: "flex", flexDirection: "column" }}>
      <ListTable
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
