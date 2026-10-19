import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { cells } from "../../test/list";
import { json, renderWithQueries, serve } from "../../test/server";
import { preciseTime } from "../../time";
import { addressText, type Params } from "../address";
import { DbView } from "./DbView";

const AT = "2026-10-14T20:27:20.096+00:00";

function serveDb(): Request[] {
  return serve({
    "GET /api/db/tables": () =>
      json({
        tables: [
          { table: "registry_repositories", category: "registry", rows: 2, latest: `${AT} #1` },
          { table: "old_things", category: null, rows: 1, latest: null },
        ],
        warnings: ["1 table this version doesn't know: old_things"],
      }),
    "GET /api/db/tables/registry_repositories": () =>
      json({
        columns: [
          { name: "id", type: "id" },
          { name: "name", type: "plain" },
          { name: "modified_at", type: "clock" },
          { name: "deleted", type: "plain" },
        ],
        rows: [
          { id: "01a2", name: "two", modified_at: `${AT} #2`, deleted: null },
          { id: "01a1", name: "one", modified_at: `${AT} #1`, deleted: 0 },
        ],
        warnings: [],
      }),
  });
}

/** The View as a Panel holds it: with its parameters, here shown as its address. */
function Db({ at = {} }: { at?: Params }) {
  const [params, setParams] = useState(at);
  return (
    <>
      <output>{addressText({ kind: "db", params })}</output>
      <DbView params={params} setParams={setParams} setTitle={vi.fn()} />
    </>
  );
}

describe("the Database View", () => {
  it("lists the tables, and shows one's rows when chosen", async () => {
    serveDb();
    renderWithQueries(<Db />);
    expect(await screen.findByText("1 table this version doesn't know: old_things")).toBeVisible();
    expect(screen.getByText("unknown")).toBeInTheDocument();
    expect(screen.getByText(`${preciseTime(AT)} #1`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "registry_repositories" }));
    expect(screen.getByRole("status").textContent).toBe("db?table=registry_repositories");
    expect(await screen.findByText("two")).toBeInTheDocument();
  });

  it("shows every column of the rows, by type, and a row's details", async () => {
    serveDb();
    renderWithQueries(<Db at={{ table: "registry_repositories" }} />);
    const [newest] = await screen.findAllByRole("listitem");
    expect(cells(newest as HTMLElement)).toEqual(["01a2", "two", `${preciseTime(AT)} #2`, "NULL"]);
    expect(within(newest as HTMLElement).getByTitle(`${AT} #2`)).toBeInTheDocument();
    expect(screen.getByText("modified_at")).toHaveAttribute("title", "Type: clock");
    await userEvent.click(within(newest as HTMLElement).getAllByRole("button")[0] as HTMLElement);
    const details = screen.getByRole("region", { name: "Row details" });
    expect(within(details).getByText("deleted")).toBeInTheDocument();
  });

  it("switches tables, and goes back to all of them", async () => {
    serveDb();
    renderWithQueries(<Db at={{ table: "registry_repositories" }} />);
    await screen.findByText("two");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Table" }), "old_things");
    expect(screen.getByRole("status").textContent).toBe("db?table=old_things");
    expect(await screen.findByText(/Couldn't load/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "All tables" }));
    expect(screen.getByRole("status").textContent).toBe("db");
  });
});
