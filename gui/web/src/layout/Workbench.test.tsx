import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveViews as save } from "../test/layout";
import { daemon, json, renderWithQueries, serve } from "../test/server";
import { VIEWS, type ViewProps } from "../views";
import { addressText } from "../views/address";
import { useIsShown } from "../views/opening";
import { ViewLink } from "../views/ViewLink";
import { savedLayout } from "./saved";
import { Workbench } from "./Workbench";

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

/** A View linking to Probes 1 and 2, and saying which are shown. */
function Linker() {
  const isShown = useIsShown();
  const probes = ["1", "2"];
  const shown = probes.filter((n) => isShown({ kind: "probe", params: { n } }));
  return (
    <>
      {probes.map((n) => (
        <ViewLink key={n} address={{ kind: "probe", params: { n } }} label={`Probe ${n}`} />
      ))}
      <p>shown: {shown.join(", ")}</p>
    </>
  );
}

/** Ctrl+F, as the window gets it; returns the event, to tell whether it was taken. */
function pressCtrlF(): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: "f", ctrlKey: true, cancelable: true });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

/** Clicks with Alt held, which opens beside. */
async function altClick(element: HTMLElement) {
  const user = userEvent.setup();
  await user.keyboard("{Alt>}");
  await user.click(element);
  await user.keyboard("{/Alt}");
}

const tabs = () => screen.queryAllByRole("tab").map((tab) => tab.getAttribute("aria-label"));
/** The tabs by Group, and which are previews: `Probe*`. */
const groups = () =>
  [...document.querySelectorAll(".dv-groupview")].map((group) =>
    [...group.querySelectorAll("[role=tab]")].map(
      (tab) =>
        `${tab.getAttribute("aria-label")}${tab.querySelector("[class*=preview]") ? "*" : ""}`,
    ),
  );

beforeEach(() => {
  serve({
    "GET /api/daemon": () => json(daemon()),
    "GET /api/events": () => json([]),
    "GET /api/repositories": () => json([]),
  });
});

describe("the Workbench", () => {
  it("starts with the Repositories and Events, and saves its Layout", async () => {
    renderWithQueries(<Workbench />);
    expect(await screen.findByText(/^No Repositories yet/)).toBeInTheDocument();
    expect(await screen.findByText("No Events yet.")).toBeInTheDocument();
    expect(tabs()).toEqual(["Repositories", "Events"]);
    await waitFor(() =>
      expect(savedViews()).toEqual([
        { kind: "repositories", params: {} },
        { kind: "events", params: {} },
      ]),
    );
  });

  it("closes the active Panel on Ctrl+W, then its emptied Group, but not the last", async () => {
    renderWithQueries(<Workbench />);
    expect(await screen.findByText("No Events yet.")).toBeInTheDocument();
    await userEvent.keyboard("{Control>}w{/Control}");
    expect(groups()).toEqual([["Repositories"], []]);
    await userEvent.keyboard("{Control>}w{/Control}");
    expect(groups()).toEqual([["Repositories"]]);
    await userEvent.keyboard("{Control>}w{/Control}");
    await userEvent.keyboard("{Control>}w{/Control}");
    expect(groups()).toEqual([[]]);
    expect(screen.queryByRole("button", { name: "Close this Group" })).toBeNull();
  });

  it("keeps a Group emptied, also once restored, until it is closed", async () => {
    const { unmount } = renderWithQueries(<Workbench />);
    const [, events] = screen.getAllByRole("tab");
    await userEvent.click(within(events as HTMLElement).getByRole("button", { name: "Close tab" }));
    expect(groups()).toEqual([["Repositories"], []]);
    await waitFor(() => expect(savedViews()).toHaveLength(1));
    unmount();
    renderWithQueries(<Workbench />);
    expect(groups()).toEqual([["Repositories"], []]);
    await userEvent.click(screen.getByRole("button", { name: "Close this Group" }));
    expect(groups()).toEqual([["Repositories"]]);
    expect(screen.queryByRole("button", { name: "Close this Group" })).toBeNull();
  });

  it("shows each View's icon in its tab and in the lists of Views", () => {
    renderWithQueries(<Workbench />);
    const icons = (element: Element) =>
      [...element.querySelectorAll("svg")].map((icon) => icon.getAttribute("class"));
    const [repositories, events] = screen.getAllByRole("tab");
    expect(icons(repositories as HTMLElement)).toContainEqual(
      expect.stringMatching(/lucide-folder-git/),
    );
    expect(icons(events as HTMLElement)).toContainEqual(expect.stringMatching(/lucide-calendar/));
    const [choice] = screen.getAllByRole("button", { name: "Config", hidden: true });
    expect(icons(choice as HTMLElement)).toEqual([expect.stringMatching(/lucide-sliders/)]);
  });

  it("gives a tab its whole title as a tooltip while cut off", async () => {
    renderWithQueries(<Workbench />);
    const [tab] = screen.getAllByRole("tab");
    const title = tab?.querySelector(".dv-default-tab-content") as HTMLElement;
    const ours = title.closest(".dv-default-tab")?.parentElement as HTMLElement; // around it
    Object.defineProperty(title, "clientWidth", { value: 100 });
    Object.defineProperty(title, "scrollWidth", { value: 30, configurable: true });
    fireEvent.pointerEnter(ours);
    expect(title).not.toHaveAttribute("title");
    Object.defineProperty(title, "scrollWidth", { value: 300 });
    fireEvent.pointerEnter(ours);
    expect(title).toHaveAttribute("title", "Repositories");
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
    expect(tabs()).toEqual(["Repositories", "Events"]);
  });

  it("focuses an open View instead of opening it twice, flashing its tab", async () => {
    renderWithQueries(<Workbench />);
    const animate = vi.spyOn(Element.prototype, "animate");
    // jsdom can't open the "+" menus, popovers, so their choices count as hidden.
    const [, inEvents] = screen.getAllByRole("button", { name: "Repositories", hidden: true });
    await userEvent.click(inEvents as HTMLElement);
    expect(tabs()).toEqual(["Repositories", "Events"]);
    const [repositories] = screen.getAllByRole("tab");
    expect(animate.mock.contexts).toEqual([repositories]);
    animate.mockRestore();
  });

  it("lets a View open another beside it by Alt, splitting its Group off when alone", async () => {
    serve({
      "GET /api/daemon": () => json(daemon()),
      "GET /api/events": () => json([]),
      "GET /api/log": () => json({ entries: [], skipped: 0 }),
    });
    save("daemon", "events");
    renderWithQueries(<Workbench />);
    const link = await screen.findByRole("button", { name: "The Daemon's log" });
    expect(link).toHaveTextContent("Log");
    await altClick(link);
    expect(groups()).toEqual([["daemon", "Events"], ["Log: daemon[4242]*"]]);
    await waitFor(() =>
      expect(savedViews()).toContainEqual({
        kind: "log",
        params: { pid: "4242", process: "daemon" },
        preview: true,
      }),
    );
  });

  describe("with previews", () => {
    beforeEach(() => {
      VIEWS.linker = Linker;
      VIEWS.probe = Probe;
      save("linker");
    });
    afterEach(() => {
      delete VIEWS.linker;
      delete VIEWS.probe;
    });

    it("opens one in its Group, which the next replaces, and saves it as a preview", async () => {
      renderWithQueries(<Workbench />);
      await userEvent.click(screen.getByRole("button", { name: "Probe 1" }));
      expect(groups()).toEqual([["linker", "probe*"]]);
      await userEvent.click(screen.getByRole("tab", { name: "linker" })); // a frame later
      await userEvent.click(await screen.findByRole("button", { name: "Probe 2" }));
      expect(groups()).toEqual([["linker", "probe*"]]);
      expect(screen.getByRole("button", { name: "probe?n=2" })).toBeInTheDocument();
      await waitFor(() =>
        expect(savedViews()).toContainEqual({ kind: "probe", params: { n: "2" }, preview: true }),
      );
    });

    it("opens one beside by the middle button or Alt, which the next replaces", async () => {
      renderWithQueries(<Workbench />);
      await userEvent.pointer({
        keys: "[MouseMiddle]",
        target: screen.getByRole("button", { name: "Probe 1" }),
      });
      expect(groups()).toEqual([["linker"], ["probe*"]]);
      await altClick(screen.getByRole("button", { name: "Probe 2" }));
      expect(groups()).toEqual([["linker"], ["probe*"]]);
      expect(screen.getByRole("button", { name: "probe?n=2" })).toBeInTheDocument();
    });

    it("tells Views which are shown: each Group's visible Panel's", async () => {
      renderWithQueries(<Workbench />);
      expect(screen.getByText(/^shown:/)).toHaveTextContent(/^shown:$/);
      await altClick(screen.getByRole("button", { name: "Probe 1" }));
      expect(screen.getByText(/^shown:/)).toHaveTextContent("shown: 1");
      await altClick(screen.getByRole("button", { name: "Probe 2" }));
      expect(screen.getByText(/^shown:/)).toHaveTextContent("shown: 2");
      await userEvent.dblClick(screen.getByText("probe", { selector: ".dv-default-tab *" }));
      await altClick(screen.getByRole("button", { name: "Probe 1" }));
      expect(groups()).toEqual([["linker"], ["probe", "probe*"]]);
      expect(screen.getByText(/^shown:/)).toHaveTextContent("shown: 1");
    });

    it("keeps a preview whose tab is double-clicked", async () => {
      renderWithQueries(<Workbench />);
      await userEvent.click(screen.getByRole("button", { name: "Probe 1" }));
      await userEvent.dblClick(screen.getByText("probe", { selector: ".dv-default-tab *" }));
      expect(groups()).toEqual([["linker", "probe"]]);
      await userEvent.click(screen.getByRole("tab", { name: "linker" })); // a frame later
      await userEvent.click(await screen.findByRole("button", { name: "Probe 2" }));
      expect(groups()).toEqual([["linker", "probe", "probe*"]]);
    });

    it("keeps a preview that is changed", async () => {
      renderWithQueries(<Workbench />);
      await userEvent.click(screen.getByRole("button", { name: "Probe 1" }));
      await userEvent.click(screen.getByRole("button", { name: "probe?n=1" }));
      expect(groups()).toEqual([["linker", "Probe, 1h"]]);
    });

    it("restores a preview as one", async () => {
      const { unmount } = renderWithQueries(<Workbench />);
      await altClick(screen.getByRole("button", { name: "Probe 1" }));
      await waitFor(() => expect(savedViews()).toHaveLength(2));
      unmount();
      renderWithQueries(<Workbench />);
      expect(groups()).toEqual([["linker"], ["probe*"]]);
    });
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

  it("goes to the active Panel's search field on Ctrl+F, if its View has one", async () => {
    VIEWS.searcher = () => <input type="search" aria-label="Find" defaultValue="old" />;
    VIEWS.probe = Probe;
    try {
      save("searcher", "probe");
      const { unmount } = renderWithQueries(<Workbench />);
      const field = (await screen.findByRole("searchbox", { name: "Find" })) as HTMLInputElement;
      await userEvent.click(screen.getByRole("tab", { name: "searcher" }));
      field.blur();
      expect(pressCtrlF().defaultPrevented).toBe(true); // taken from the browser
      expect(field).toHaveFocus();
      expect([field.selectionStart, field.selectionEnd]).toEqual([0, 3]);
      unmount();
      // The search field's View behind another: Ctrl+F is the browser's.
      save("probe", "searcher");
      renderWithQueries(<Workbench />);
      await userEvent.click(await screen.findByRole("tab", { name: "probe" }));
      expect(pressCtrlF().defaultPrevented).toBe(false);
    } finally {
      delete VIEWS.searcher;
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
    const suggested = within(screen.getByRole("list")).getAllByRole("button");
    expect(suggested.map((choice) => choice.textContent)).toEqual(["Repositories", "Events"]);
    await userEvent.click(suggested[0] as HTMLElement);
    expect(tabs()).toEqual(["Repositories"]);
  });
});
