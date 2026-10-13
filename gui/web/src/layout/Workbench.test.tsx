import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { daemon, json, renderWithQueries, serve } from "../test/server";
import { savedLayout } from "./saved";
import { Workbench } from "./Workbench";

/** A saved Layout: one Group holding these Panels, by ID. */
function save(...ids: string[]): void {
  const panels = Object.fromEntries(
    ids.map((id) => [id, { id, contentComponent: "view", title: id }]),
  );
  const leaf = { type: "leaf", data: { views: ids, activeView: ids[0], id: "1" }, size: 800 };
  const grid = {
    root: { type: "branch", data: [leaf], size: 600 },
    width: 800,
    height: 600,
    orientation: "HORIZONTAL",
  };
  localStorage.setItem("hephaistos.layout", JSON.stringify({ format: 1, dock: { grid, panels } }));
}

const tabs = () => screen.queryAllByRole("tab").map((tab) => tab.getAttribute("aria-label"));

beforeEach(() => {
  serve({ "GET /api/daemon": () => json(daemon()), "GET /api/events": () => json([]) });
});

describe("the Workbench", () => {
  it("starts with the Daemon and Events, and saves its Layout", async () => {
    renderWithQueries(<Workbench />);
    expect(await screen.findByText(/^running, pid 4242/)).toBeInTheDocument();
    expect(await screen.findByText("No Events yet.")).toBeInTheDocument();
    expect(tabs()).toEqual(["Daemon", "Events"]);
    await waitFor(() => expect(savedLayout()?.panels).toHaveProperty("daemon"));
  });

  it("restores the saved Layout, saying which Views no longer exist", async () => {
    save("gone", "daemon");
    renderWithQueries(<Workbench />);
    expect(await screen.findByText(/no longer exists/)).toBeInTheDocument();
    expect(tabs()).toEqual(["gone", "daemon"]);
  });

  it("starts anew from a Layout it can't restore", () => {
    localStorage.setItem("hephaistos.layout", '{"format": 1, "dock": {"grid": 5}}');
    renderWithQueries(<Workbench />);
    expect(tabs()).toEqual(["Daemon", "Events"]);
  });

  it("focuses an open View instead of opening it twice", async () => {
    renderWithQueries(<Workbench />);
    // jsdom can't open the "+" menus, popovers, so their choices count as hidden.
    const [, inEvents] = screen.getAllByRole("button", { name: "Daemon", hidden: true });
    await userEvent.click(inEvents as HTMLElement);
    expect(tabs()).toEqual(["Daemon", "Events"]);
  });

  it("offers Views in an empty Group", async () => {
    save("gone");
    renderWithQueries(<Workbench />);
    await userEvent.click(screen.getByRole("button", { name: "Close gone" }));
    expect(tabs()).toEqual([]);
    expect(screen.getByText("Open a View:")).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole("list")).getByRole("button", { name: "Daemon" }));
    expect(tabs()).toEqual(["Daemon"]);
  });
});
