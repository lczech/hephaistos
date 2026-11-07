import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { QUERY_DEFAULTS } from "../api/queries";
import { TitleBar } from "../components/TitleBar";
import { saveGrid } from "../test/layout";
import { daemon, json, serve } from "../test/server";
import { ViewOpener } from "./ViewOpener";
import { Workbench } from "./Workbench";

const WIDTH = 1200;

/** The title bar over a Workbench this wide, as the page lays them out. */
function renderShell() {
  render(
    <QueryClientProvider client={new QueryClient(QUERY_DEFAULTS)}>
      <ViewOpener>
        <TitleBar />
        <div style={{ width: WIDTH, height: 600 }}>
          <Workbench />
        </div>
      </ViewOpener>
    </QueryClientProvider>,
  );
}

/** The Groups' widths on screen, in reading order. */
const widths = () =>
  [...document.querySelectorAll(".dv-groupview")].map((group) =>
    Math.round(group.getBoundingClientRect().width),
  );

/** Whether the widths are even, as near as whole pixels and dividers allow. */
const even = (sizes: number[]) => Math.max(...sizes) - Math.min(...sizes) <= 2;

beforeEach(() => {
  serve({ "GET /api/daemon": () => json(daemon()) });
});

describe("the column buttons, as shown", () => {
  it("make columns of even widths, filling the Workbench", async () => {
    saveGrid(
      [
        { tabs: ["a", "b", "c"], size: 900 },
        { tabs: ["d"], size: 300 },
      ],
      "HORIZONTAL",
    );
    renderShell();
    await screen.findByRole("tab", { name: "a" });
    await userEvent.click(screen.getByRole("button", { name: "3 columns" }));
    await waitFor(() => expect(widths()).toHaveLength(3));
    expect(even(widths())).toBe(true);
    expect(widths().reduce((sum, width) => sum + width, 0)).toBeGreaterThan(WIDTH - 4);
  });

  it("even out the columns' widths when pressed for as many as there are", async () => {
    saveGrid(
      [
        { tabs: ["a"], size: 900 },
        { tabs: ["b"], size: 300 },
      ],
      "HORIZONTAL",
    );
    renderShell();
    await screen.findByRole("tab", { name: "a" });
    await waitFor(() => expect(even(widths())).toBe(false));
    await userEvent.click(screen.getByRole("button", { name: "2 columns" }));
    await waitFor(() => expect(even(widths())).toBe(true));
    expect(widths()).toHaveLength(2);
  });
});
