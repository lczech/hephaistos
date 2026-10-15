import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { daemon, json, renderWithQueries, serve } from "../test/server";
import { VIEWS, type ViewProps } from "../views";
import { addressText } from "../views/address";
import { savedLayout } from "./saved";
import { Workbench } from "./Workbench";

/** A saved Layout: one Group holding a Panel for each of these kinds of View. */
function save(...kinds: string[]): void {
  const panels = Object.fromEntries(
    kinds.map((kind, i) => {
      const id = `${i}`;
      return [id, { id, contentComponent: "view", title: kind, params: { kind, params: {} } }];
    }),
  );
  const ids = Object.keys(panels);
  const leaf = { type: "leaf", data: { views: ids, activeView: ids[0], id: "1" }, size: 800 };
  const grid = {
    root: { type: "branch", data: [leaf], size: 600 },
    width: 800,
    height: 600,
    orientation: "HORIZONTAL",
  };
  localStorage.setItem("hephaistos.layout", JSON.stringify({ format: 2, dock: { grid, panels } }));
}

const savedViews = () => Object.values(savedLayout()?.panels ?? {}).map((panel) => panel.params);
/** A View showing its address, which narrows it to the last hour when clicked, and says so. */
function Probe({ params, setParams, setTitle }: ViewProps) {
  const narrow = () => {
    setParams({ since: "1h" });
    setTitle("Probe, 1h");
  };
  return (
    <button type="button" onClick={narrow}>
      {addressText({ kind: "probe", params })}
    </button>
  );
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
    await waitFor(() =>
      expect(savedViews()).toEqual([
        { kind: "daemon", params: {} },
        { kind: "events", params: {} },
      ]),
    );
  });

  it("shows each View's icon in its tab and in the lists of Views", () => {
    renderWithQueries(<Workbench />);
    const icons = (element: Element) =>
      [...element.querySelectorAll("svg")].map((icon) => icon.getAttribute("class"));
    const [daemon, events] = screen.getAllByRole("tab");
    expect(icons(daemon as HTMLElement)).toContainEqual(expect.stringMatching(/lucide-activity/));
    expect(icons(events as HTMLElement)).toContainEqual(expect.stringMatching(/lucide-calendar/));
    const [choice] = screen.getAllByRole("button", { name: "Config", hidden: true });
    expect(icons(choice as HTMLElement)).toEqual([expect.stringMatching(/lucide-sliders/)]);
  });

  it("restores the saved Layout, saying which Views no longer exist", async () => {
    save("gone", "daemon");
    renderWithQueries(<Workbench />);
    expect(await screen.findByText(/no longer exists/)).toBeInTheDocument();
    expect(tabs()).toEqual(["gone", "daemon"]);
  });

  it("starts anew from a Layout it can't restore", () => {
    localStorage.setItem("hephaistos.layout", '{"format": 2, "dock": {"grid": 5}}');
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

  it("lets a View open another in its Group", async () => {
    serve({
      "GET /api/daemon": () => json(daemon()),
      "GET /api/events": () => json([]),
      "GET /api/log": () => json({ entries: [], skipped: 0 }),
    });
    renderWithQueries(<Workbench />);
    await userEvent.click(await screen.findByRole("button", { name: "The Daemon's log" }));
    expect(tabs()).toEqual(["Daemon", "Log: daemon[4242]", "Events"]);
    await waitFor(() =>
      expect(savedViews()).toContainEqual({
        kind: "log",
        params: { pid: "4242", process: "daemon" },
      }),
    );
  });

  it("lets a View show other parameters in its Panel and name its tab, and saves both", async () => {
    VIEWS.probe = Probe;
    try {
      save("probe");
      renderWithQueries(<Workbench />);
      await userEvent.click(screen.getByRole("button", { name: "probe" }));
      expect(screen.getByRole("button", { name: "probe?since=1h" })).toBeInTheDocument();
      expect(tabs()).toEqual(["Probe, 1h"]);
      await waitFor(() =>
        expect(savedViews()).toEqual([{ kind: "probe", params: { since: "1h" } }]),
      );
    } finally {
      delete VIEWS.probe;
    }
  });

  it("offers Views in an empty Group", async () => {
    save("gone");
    renderWithQueries(<Workbench />);
    const [tab] = screen.getAllByRole("tab");
    await userEvent.click(within(tab as HTMLElement).getByRole("button", { name: "Close tab" }));
    expect(tabs()).toEqual([]);
    expect(screen.getByText("Open a View:")).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole("list")).getByRole("button", { name: "Daemon" }));
    expect(tabs()).toEqual(["Daemon"]);
  });
});
