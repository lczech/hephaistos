import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { QUERY_DEFAULTS } from "../api/queries";
import { saveGrid } from "../test/layout";
import { daemon, json, serve } from "../test/server";
import { Workbench } from "./Workbench";

// How dockview hides the Views of tabs not shown, which stay drawn (`PanelView`): Views rely on
// it, e.g. the band of a List, which inherits its visibility so as to hide with them.

beforeEach(() => {
  serve({ "GET /api/daemon": () => json(daemon()) });
});

describe("a View of a tab not shown, kept drawn", () => {
  it("is hidden by its visibility, which what lies in it inherits", async () => {
    saveGrid([{ tabs: ["a", "b"] }], "HORIZONTAL");
    render(
      <QueryClientProvider client={new QueryClient(QUERY_DEFAULTS)}>
        <div style={{ width: 1200, height: 800 }}>
          <Workbench />
        </div>
      </QueryClientProvider>,
    );
    await userEvent.click(await screen.findByRole("tab", { name: "b" }));
    // Both drawn, that of tab a from when it was shown first, as unknown kinds: "no longer exists".
    const views = () => screen.getAllByText(/This view no longer exists/);
    await waitFor(() => expect(views()).toHaveLength(2));
    const seen = () => views().map((view) => getComputedStyle(view).visibility);
    await waitFor(() => expect(seen().sort()).toEqual(["hidden", "visible"]));
  });
});
