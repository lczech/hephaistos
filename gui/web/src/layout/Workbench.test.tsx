import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KEYS } from "../api/queries";
import { SearchField } from "../components/SearchField";
import { saveViews as save, saveGrid } from "../test/layout";
import { daemon, info, json, renderWithQueries, serve, setting, status } from "../test/server";
import { VIEWS, type ViewProps } from "../views";
import { addressText } from "../views/address";
import { useKeyTarget } from "../views/keys";
import { useIsShown } from "../views/opening";
import { ViewLink } from "../views/ViewLink";
import { savedLayout } from "./saved";
import { useDock, ViewOpener } from "./ViewOpener";
import { Workbench } from "./Workbench";

const savedViews = () => Object.values(savedLayout()?.panels ?? {}).map((panel) => panel.params);
/**
 * A View showing its address, which narrows it to the last hour when clicked, and says so; and
 * a mark of its own, as a scroll position is.
 */
function Probe({ params, setParams, fragment, setFragment, setTitle }: ViewProps) {
  const [marked, setMarked] = useState(false);
  const narrow = () => {
    setParams({ since: "1h" });
    setTitle("Probe, 1h");
  };
  return (
    <>
      <button type="button" onClick={narrow}>
        {addressText({ kind: "probe", params, fragment })}
      </button>
      <button type="button" onClick={() => setFragment({ find: "x" })}>
        Find x
      </button>
      <button type="button" aria-pressed={marked} onClick={() => setMarked(true)}>
        Mark
      </button>
    </>
  );
}

/** A View with a field whose text is a parameter, changed at each key, as in a search. */
function Typer({ params, setParams, endTyping }: ViewProps) {
  return (
    <input
      aria-label="Text"
      value={typeof params.text === "string" ? params.text : ""}
      onChange={(event) => setParams({ text: event.target.value }, true)}
      onBlur={endTyping}
    />
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
function pressCtrlF(key = "f", code = "KeyF"): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, code, ctrlKey: true, cancelable: true });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

/** Passes on the dock, once there. */
function DockOf({ found }: { found: (api: ReturnType<typeof useDock>) => void }) {
  const api = useDock();
  useEffect(() => found(api));
  return null;
}

/** A frame passing: dockview shows Views over their Groups at the next. */
const nextFrame = () => act(() => new Promise<void>((done) => requestAnimationFrame(() => done())));

async function renderWorkbench() {
  const rendered = renderWithQueries(<Workbench />);
  await nextFrame();
  return rendered;
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
  // Views are drawn over their Groups where these are, and stay hidden while 0 by 0, as all are
  // without a layout: each as large as a page.
  const page = { x: 0, y: 0, left: 0, top: 0, width: 1200, height: 800, right: 1200, bottom: 800 };
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    ...page,
    toJSON: () => page,
  });
  serve(ROUTES);
});

const ROUTES = {
  "GET /api/daemon": () => json(daemon()),
  "GET /api/status": () => json(status()),
  "GET /api/events": () => json([]),
  "GET /api/repositories": () => json([]),
  "GET /api/config": () => json({ settings: [] }),
  "GET /api/info": () => json(info()),
  "GET /api/machines": () => json([]),
  "GET /api/events/kinds": () => json([]),
};

/** With `gui.keep_empty_groups` on; rendered once the GUI knows it. */
async function renderKeepingEmptyGroups() {
  serve({
    ...ROUTES,
    "GET /api/config": () => json({ settings: [setting("gui.keep_empty_groups", true)] }),
  });
  const rendered = await renderWorkbench();
  // Its answer, not only its request: it may come later.
  await waitFor(() => expect(rendered.client.getQueryData(KEYS.config)).toBeDefined());
  await nextFrame();
  return rendered;
}

describe("the Workbench", () => {
  it("starts with the Repositories and Events, and saves its Layout", async () => {
    await renderWorkbench();
    expect(await screen.findByText(/^No repositories yet/)).toBeInTheDocument();
    expect(await screen.findByText("No events yet.")).toBeInTheDocument();
    expect(tabs()).toEqual(["Repositories", "Events"]);
    await waitFor(() =>
      expect(savedViews()).toEqual([
        { kind: "repositories", params: {} },
        { kind: "events", params: {} },
      ]),
    );
  });

  it("closes a Group with its last Panel, but not the last Group", async () => {
    await renderWorkbench();
    expect(await screen.findByText("No events yet.")).toBeInTheDocument();
    await userEvent.keyboard("{Control>}w{/Control}");
    expect(groups()).toEqual([["Repositories"]]);
    await userEvent.keyboard("{Control>}w{/Control}");
    expect(groups()).toEqual([[]]);
  });

  it("closes the active Panel on Ctrl+W, then its emptied Group, but not the last", async () => {
    await renderKeepingEmptyGroups();
    expect(await screen.findByText("No events yet.")).toBeInTheDocument();
    await userEvent.keyboard("{Control>}w{/Control}");
    expect(groups()).toEqual([["Repositories"], []]);
    // With Caps Lock on, as the key then reads.
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "W", ctrlKey: true }));
    });
    expect(groups()).toEqual([["Repositories"]]);
    await userEvent.keyboard("{Control>}w{/Control}");
    await userEvent.keyboard("{Control>}w{/Control}");
    expect(groups()).toEqual([[]]);
    expect(screen.queryByRole("button", { name: "Close this group" })).toBeNull();
  });

  it("closes by the letter typed, or by the place of the key where that letter is not Latin", async () => {
    await renderKeepingEmptyGroups();
    expect(await screen.findByText("No events yet.")).toBeInTheDocument();
    const press = (key: string, code: string) =>
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key, code, ctrlKey: true }));
      });
    press("z", "KeyW"); // AZERTY: the key in the place of W types z
    expect(groups()).toEqual([["Repositories"], ["Events"]]);
    press("w", "KeyZ");
    expect(groups()).toEqual([["Repositories"], []]);
    press("ц", "KeyW"); // Cyrillic
    expect(groups()).toEqual([["Repositories"]]);
  });

  it("keeps a Group emptied, also once restored, until it is closed", async () => {
    const { unmount } = await renderKeepingEmptyGroups();
    const [, events] = screen.getAllByRole("tab");
    await userEvent.click(within(events as HTMLElement).getByRole("button", { name: "Close tab" }));
    expect(groups()).toEqual([["Repositories"], []]);
    await waitFor(() => expect(savedViews()).toHaveLength(1));
    unmount();
    await renderWorkbench();
    expect(groups()).toEqual([["Repositories"], []]);
    await userEvent.click(screen.getByRole("button", { name: "Close this group" }));
    expect(groups()).toEqual([["Repositories"]]);
    expect(screen.queryByRole("button", { name: "Close this group" })).toBeNull();
  });

  it("keeps a Group emptied when restored before the settings are in", async () => {
    const { unmount } = await renderKeepingEmptyGroups();
    const [, events] = screen.getAllByRole("tab");
    await userEvent.click(within(events as HTMLElement).getByRole("button", { name: "Close tab" }));
    await waitFor(() => expect(savedViews()).toHaveLength(1));
    unmount();
    let answer = () => {};
    const held = new Promise<void>((resolve) => {
      answer = resolve;
    });
    serve({
      ...ROUTES,
      "GET /api/config": async () => {
        await held;
        return json({ settings: [setting("gui.keep_empty_groups", true)] });
      },
    });
    await renderWorkbench();
    expect(groups()).toEqual([["Repositories"], []]);
    answer();
    await nextFrame();
    expect(groups()).toEqual([["Repositories"], []]);
  });

  it('shows each View\'s icon in its tab and in the "+" menu', async () => {
    await renderWorkbench();
    const icons = (element: Element) =>
      [...element.querySelectorAll("svg")].map((icon) => icon.getAttribute("class"));
    const [repositories, events] = screen.getAllByRole("tab");
    expect(icons(repositories as HTMLElement)).toContainEqual(
      expect.stringMatching(/lucide-book-copy/),
    );
    expect(icons(events as HTMLElement)).toContainEqual(expect.stringMatching(/lucide-calendar/));
    const [add] = screen.getAllByRole("button", { name: "Open a view" });
    await userEvent.click(add as HTMLElement);
    const choice = screen.getByRole("menuitem", { name: "Events" });
    expect(icons(choice)).toEqual([expect.stringMatching(/lucide-calendar/)]);
  });

  it('offers the Views at hand by its "+", opening one in its Group', async () => {
    await renderWorkbench();
    const [repositories] = screen.getAllByRole("tab");
    await userEvent.click(
      within(repositories as HTMLElement).getByRole("button", { name: "Close tab" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Open a view" }));
    const choices = screen.getAllByRole("menuitem").map((choice) => choice.textContent);
    expect(choices).toEqual(["Repositories", "Events"]);
    await userEvent.click(screen.getByRole("menuitem", { name: "Repositories" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(groups()).toEqual([["Events", "Repositories"]]);
  });

  it("gives a tab its whole title as a tooltip, as it changes", async () => {
    VIEWS.probe = Probe;
    try {
      save("probe");
      await renderWorkbench();
      const [tab] = screen.getAllByRole("tab");
      const tooltip = () => within(tab as HTMLElement).getByTitle(/./);
      expect(tooltip()).toHaveAttribute("title", "probe");
      await userEvent.click(screen.getByRole("button", { name: "probe" })); // titled anew
      expect(tooltip()).toHaveAttribute("title", "Probe, 1h");
    } finally {
      delete VIEWS.probe;
    }
  });

  it("saves a change made just before it goes, or the page does", async () => {
    VIEWS.probe = Probe;
    try {
      save("probe");
      const { unmount } = await renderWorkbench();
      await userEvent.click(screen.getByRole("button", { name: "probe" }));
      unmount(); // within the delay of saving
      expect(savedViews()).toEqual([{ kind: "probe", params: { since: "1h" } }]);
      save("probe");
      await renderWorkbench();
      await userEvent.click(screen.getByRole("button", { name: "probe" }));
      window.dispatchEvent(new Event("pagehide"));
      expect(savedViews()).toEqual([{ kind: "probe", params: { since: "1h" } }]);
    } finally {
      delete VIEWS.probe;
    }
  });

  it("takes Alt+← and Alt+→ from the browser, also with nothing to go to", async () => {
    save("status");
    await renderWorkbench();
    for (const key of ["ArrowLeft", "ArrowRight"]) {
      const event = new KeyboardEvent("keydown", { key, altKey: true, cancelable: true });
      act(() => {
        window.dispatchEvent(event);
      });
      expect(event.defaultPrevented).toBe(true); // else the browser leaves the page
    }
  });

  it("restores the saved Layout, saying which Views no longer exist", async () => {
    save("gone", "status");
    await renderWorkbench();
    expect(await screen.findByText(/no longer exists/)).toBeInTheDocument();
    expect(tabs()).toEqual(["gone", "status"]);
  });

  it("builds a View once its tab is first shown, then keeps it drawn while hidden", async () => {
    VIEWS.probe = Probe;
    VIEWS.typer = Typer;
    try {
      save("probe", "typer");
      await renderWorkbench();
      expect(await screen.findByRole("button", { name: "probe" })).toBeInTheDocument();
      const field = () => document.querySelector<HTMLInputElement>("input[aria-label=Text]");
      expect(field()).toBeNull(); // not shown yet
      await userEvent.click(screen.getByRole("tab", { name: "typer" }));
      // Drawn by dockview's portal once the tab is shown, which may be a moment after the click.
      await userEvent.type(await screen.findByRole("textbox", { name: "Text" }), "kept");
      await userEvent.click(screen.getByRole("tab", { name: "probe" }));
      // Hidden, but still in the page as it was.
      expect(field()).toBeInTheDocument();
      expect(field()).toHaveValue("kept");
      // Restored, Panels are built once shown again: how they were drawn is not saved.
      await waitFor(() =>
        expect(savedViews()).toContainEqual({ kind: "typer", params: { text: "kept" } }),
      );
      expect(Object.values(savedLayout()?.panels ?? {}).map((panel) => panel.renderer)).toEqual([
        undefined,
        undefined,
      ]);
    } finally {
      delete VIEWS.probe;
      delete VIEWS.typer;
    }
  });

  it("asks nothing for a restored Diff never shown, its tab keeping the title saved", async () => {
    const requests = serve(ROUTES);
    const diff = { clone: "clone-proj", from: "HEAD", to: "worktree" };
    const panels = {
      a: {
        id: "a",
        contentComponent: "view",
        title: "Status",
        params: { kind: "status", params: {} },
      },
      b: {
        id: "b",
        contentComponent: "view",
        title: "Diff: proj",
        params: { kind: "diff", params: diff },
      },
    };
    const leaf = { type: "leaf", data: { views: ["a", "b"], activeView: "a", id: "1" }, size: 800 };
    const grid = { root: { type: "branch", data: [leaf], size: 600 }, width: 800, height: 600 };
    localStorage.setItem(
      "hephaistos.layout",
      JSON.stringify({ format: 2, dock: { grid: { ...grid, orientation: "HORIZONTAL" }, panels } }),
    );
    await renderWorkbench();
    const asked = () => requests.map((request) => new URL(request.url).pathname);
    await waitFor(() => expect(asked()).toContain("/api/status")); // the Status shown
    await nextFrame();
    expect(tabs()).toEqual(["Status", "Diff: proj"]);
    expect(asked().filter((path) => /changes|diff/.test(path))).toEqual([]);
  });

  it("starts anew from a Layout it cannot restore", async () => {
    localStorage.setItem("hephaistos.layout", '{"format": 2, "dock": {"grid": 5}}');
    await renderWorkbench();
    expect(tabs()).toEqual(["Repositories", "Events"]);
  });

  it("focuses an open View instead of opening it twice, flashing its tab", async () => {
    await renderWorkbench();
    const animate = vi.spyOn(Element.prototype, "animate");
    const [, inEvents] = screen.getAllByRole("button", { name: "Open a view" });
    await userEvent.click(inEvents as HTMLElement);
    await userEvent.click(screen.getByRole("menuitem", { name: "Repositories" }));
    expect(tabs()).toEqual(["Repositories", "Events"]);
    const [repositories] = screen.getAllByRole("tab");
    expect(animate.mock.contexts).toEqual([
      within(repositories as HTMLElement).getByTitle("Repositories"),
    ]);
    animate.mockRestore();
  });

  it("lets a View open another beside it by Alt, splitting its Group off when alone", async () => {
    serve({
      ...ROUTES,
      "GET /api/log": () => json({ entries: [], skipped: 0 }),
    });
    save("status", "events");
    await renderWorkbench();
    const link = await screen.findByRole("button", { name: "The log of the daemon" });
    expect(link).toHaveTextContent("Log");
    await altClick(link);
    // Events, never shown, keeps the title its Layout saved: its View is built once shown.
    expect(groups()).toEqual([["status", "events"], ["Log: daemon[4242]*"]]);
    await waitFor(() =>
      expect(savedViews()).toContainEqual({
        kind: "log",
        params: { pid: "4242", process: "daemon" },
        preview: true,
      }),
    );
  });

  it("goes back by the mouse's side button in the Group a Panel moved to", async () => {
    saveGrid([{ tabs: ["p", "q"] }, { tabs: ["r"] }], "HORIZONTAL");
    let dock: ReturnType<typeof useDock> = null;
    renderWithQueries(
      <ViewOpener>
        <Workbench />
        <DockOf
          found={(api) => {
            dock = api;
          }}
        />
      </ViewOpener>,
    );
    await nextFrame();
    await userEvent.click(screen.getByRole("tab", { name: "q" })); // Group 1: p, then q
    await userEvent.click(screen.getByRole("tab", { name: "r" }));
    const api = dock as unknown as NonNullable<ReturnType<typeof useDock>>;
    act(() => api.getPanel("q")?.api.moveTo({ group: api.groups.find(({ id }) => id === "2") }));
    await nextFrame();
    expect(groups()).toEqual([["p"], ["r", "q"]]); // Group 2: r, then q
    const q = screen.getByRole("tab", { name: "q" });
    fireEvent.mouseUp(within(q).getByText("q"), { button: 3 }); // over its tab
    await nextFrame();
    const shown = (group: Element) =>
      [...group.querySelectorAll("[role=tab]")]
        .find((tab) => tab.closest(".dv-tab")?.classList.contains("dv-active-tab"))
        ?.getAttribute("aria-label");
    expect([...document.querySelectorAll(".dv-groupview")].map(shown)).toEqual(["p", "r"]);
  });

  it('opens a View by the "+" of a Group not active in that Group', async () => {
    saveGrid([{ tabs: ["a"] }, { tabs: ["b"] }], "HORIZONTAL");
    await renderWorkbench();
    await userEvent.click(screen.getByRole("tab", { name: "a" }));
    const [, second] = screen.getAllByRole("button", { name: "Open a view" });
    await userEvent.click(second as HTMLElement);
    await userEvent.click(screen.getByRole("menuitem", { name: "Events" }));
    expect(groups()).toEqual([["a"], ["b", "Events"]]);
  });

  it("keeps a preview moved to another Group", async () => {
    saveGrid([{ tabs: ["a", "b*"] }, { tabs: ["c"] }], "HORIZONTAL");
    let dock: ReturnType<typeof useDock> = null;
    renderWithQueries(
      <ViewOpener>
        <Workbench />
        <DockOf
          found={(api) => {
            dock = api;
          }}
        />
      </ViewOpener>,
    );
    await nextFrame();
    const api = dock as unknown as NonNullable<ReturnType<typeof useDock>>;
    expect(groups()).toEqual([["a", "b*"], ["c"]]);
    act(() => api.getPanel("b")?.api.moveTo({ group: api.groups.find(({ id }) => id === "2") }));
    await nextFrame();
    expect(groups()).toEqual([["a"], ["c", "b"]]);
    await waitFor(() => expect(savedLayout()?.panels.b?.params).toEqual({ kind: "b", params: {} }));
  });

  it("shows the error of a View that fails in its own Panel only", async () => {
    VIEWS.broken = () => {
      throw new Error("bad param");
    };
    VIEWS.probe = Probe;
    const failing = vi.spyOn(console, "error").mockImplementation(() => {}); // React says so
    try {
      save("broken", "probe");
      await renderWorkbench();
      expect(await screen.findByText("Could not show this: bad param")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("tab", { name: "probe" }));
      expect(await screen.findByRole("button", { name: "probe" })).toBeInTheDocument();
      expect(tabs()).toEqual(["broken", "probe"]);
    } finally {
      failing.mockRestore();
      delete VIEWS.broken;
      delete VIEWS.probe;
    }
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
      await renderWorkbench();
      await userEvent.click(screen.getByRole("button", { name: "Probe 1" }));
      expect(groups()).toEqual([["linker", "probe*"]]);
      await userEvent.click(screen.getByRole("tab", { name: "linker" })); // a frame later
      await userEvent.click(await screen.findByRole("button", { name: "Probe 2" }));
      expect(groups()).toEqual([["linker", "probe*"]]);
      expect(await screen.findByRole("button", { name: "probe?n=2" })).toBeInTheDocument();
      await waitFor(() =>
        expect(savedViews()).toContainEqual({ kind: "probe", params: { n: "2" }, preview: true }),
      );
    });

    it("builds the View replacing a preview anew, but keeps one changed or looked at otherwise", async () => {
      await renderWorkbench();
      const mark = () => screen.getByRole("button", { name: "Mark" });
      await userEvent.click(screen.getByRole("button", { name: "Probe 1" }));
      await userEvent.click(await screen.findByRole("button", { name: "Mark" }));
      await userEvent.click(screen.getByRole("tab", { name: "linker" })); // a frame later
      await userEvent.click(await screen.findByRole("button", { name: "Probe 2" }));
      expect(await screen.findByRole("button", { name: "probe?n=2" })).toBeInTheDocument();
      expect(mark()).toHaveAttribute("aria-pressed", "false");
      await userEvent.click(mark());
      await userEvent.click(screen.getByRole("button", { name: "Find x" }));
      await userEvent.keyboard("{Alt>}{ArrowLeft}{/Alt}"); // the same View, without its fragment
      expect(await screen.findByRole("button", { name: "probe?n=2" })).toBeInTheDocument();
      expect(mark()).toHaveAttribute("aria-pressed", "true");
      await userEvent.click(screen.getByRole("button", { name: "probe?n=2" }));
      expect(await screen.findByRole("button", { name: "probe?since=1h" })).toBeInTheDocument();
      expect(mark()).toHaveAttribute("aria-pressed", "true");
    });

    it("opens one beside by the middle button or Alt, which the next replaces", async () => {
      await renderWorkbench();
      await userEvent.pointer({
        keys: "[MouseMiddle]",
        target: screen.getByRole("button", { name: "Probe 1" }),
      });
      expect(groups()).toEqual([["linker"], ["probe*"]]);
      await altClick(screen.getByRole("button", { name: "Probe 2" }));
      expect(groups()).toEqual([["linker"], ["probe*"]]);
      expect(await screen.findByRole("button", { name: "probe?n=2" })).toBeInTheDocument();
    });

    it("tells Views which are shown: each Group's visible Panel's", async () => {
      await renderWorkbench();
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

    it("marks and focuses a View however it is looked at, as it is", async () => {
      await renderWorkbench();
      await altClick(screen.getByRole("button", { name: "Probe 1" }));
      await userEvent.click(await screen.findByRole("button", { name: "Find x" }));
      expect(await screen.findByRole("button", { name: "probe?n=1#find=x" })).toBeInTheDocument();
      expect(screen.getByText(/^shown:/)).toHaveTextContent("shown: 1");
      await altClick(screen.getByRole("button", { name: "Probe 1" }));
      expect(groups()).toEqual([["linker"], ["probe"]]); // kept, as it was changed
      expect(screen.getByRole("button", { name: "probe?n=1#find=x" })).toBeInTheDocument();
      await waitFor(() =>
        expect(savedViews()).toContainEqual({
          kind: "probe",
          params: { n: "1" },
          fragment: { find: "x" },
        }),
      );
    });

    it("keeps a preview whose tab is double-clicked", async () => {
      await renderWorkbench();
      await userEvent.click(screen.getByRole("button", { name: "Probe 1" }));
      await userEvent.dblClick(screen.getByText("probe", { selector: ".dv-default-tab *" }));
      expect(groups()).toEqual([["linker", "probe"]]);
      await userEvent.click(screen.getByRole("tab", { name: "linker" })); // a frame later
      await userEvent.click(await screen.findByRole("button", { name: "Probe 2" }));
      expect(groups()).toEqual([["linker", "probe", "probe*"]]);
    });

    it("keeps a preview that is changed", async () => {
      await renderWorkbench();
      await userEvent.click(screen.getByRole("button", { name: "Probe 1" }));
      await userEvent.click(await screen.findByRole("button", { name: "probe?n=1" }));
      expect(groups()).toEqual([["linker", "Probe, 1h"]]);
    });

    it("goes back and forward through a Group's Views, by Alt+←/→", async () => {
      await renderWorkbench();
      const go = (key: string) => userEvent.keyboard(`{Alt>}{${key}}{/Alt}`);
      const probe = (n: string) => screen.findByRole("button", { name: `probe?n=${n}` });
      await userEvent.click(screen.getByRole("button", { name: "Probe 1" }));
      await userEvent.click(screen.getByRole("tab", { name: "linker" }));
      await userEvent.click(await screen.findByRole("button", { name: "Probe 2" }));
      expect(await probe("2")).toBeInTheDocument();
      await go("ArrowLeft");
      expect(await screen.findByRole("button", { name: "Probe 1" })).toBeInTheDocument();
      await go("ArrowLeft"); // replaced by Probe 2, so shown in the preview again
      expect(await probe("1")).toBeInTheDocument();
      expect(groups()).toEqual([["linker", "probe*"]]);
      await go("ArrowLeft");
      await go("ArrowLeft"); // nothing before
      expect(await screen.findByRole("button", { name: "Probe 1" })).toBeInTheDocument();
      await go("ArrowRight");
      expect(await probe("1")).toBeInTheDocument();
      await go("ArrowRight");
      await go("ArrowRight");
      expect(await probe("2")).toBeInTheDocument();
      expect(groups()).toEqual([["linker", "probe*"]]);
    });

    it("goes back to a View whose Panel was closed, shown again as a preview", async () => {
      await renderWorkbench();
      await userEvent.click(screen.getByRole("button", { name: "Probe 1" }));
      await userEvent.dblClick(screen.getByText("probe", { selector: ".dv-default-tab *" }));
      expect(groups()).toEqual([["linker", "probe"]]);
      const tab = screen.getByRole("tab", { name: "probe" });
      await userEvent.click(within(tab).getByRole("button", { name: "Close tab" }));
      expect(groups()).toEqual([["linker"]]);
      await userEvent.keyboard("{Alt>}{ArrowLeft}{/Alt}");
      expect(await screen.findByRole("button", { name: "probe?n=1" })).toBeInTheDocument();
      expect(groups()).toEqual([["linker", "probe*"]]);
    });

    it("goes back by the mouse's side button through a View's changes, in its Panel", async () => {
      await renderWorkbench();
      await userEvent.click(screen.getByRole("button", { name: "Probe 1" }));
      await userEvent.click(await screen.findByRole("button", { name: "probe?n=1" })); // narrowed, kept
      // Over the View shown, which is drawn over its Group, not in it, or over its tab.
      const over = (element: Element, button: number) => fireEvent.mouseUp(element, { button });
      const side = (button: number) => {
        const tab = screen.getByRole("tab", { selected: true });
        return over(within(tab).getByText(tab.getAttribute("aria-label") ?? ""), button);
      };
      expect(side(3)).toBe(false); // the browser's back prevented
      expect(await screen.findByRole("button", { name: "probe?n=1" })).toBeInTheDocument();
      expect(groups()).toEqual([["linker", "probe"]]);
      over(await screen.findByRole("button", { name: "probe?n=1" }), 3);
      expect(await screen.findByRole("button", { name: "Probe 1" })).toBeInTheDocument();
      side(4);
      expect(side(4)).toBe(false);
      expect(await screen.findByRole("button", { name: "probe?since=1h" })).toBeInTheDocument();
      expect(groups()).toEqual([["linker", "probe"]]);
    });

    it("goes back by the mouse's side button over an empty Group's placeholder", async () => {
      await renderKeepingEmptyGroups();
      await userEvent.click(screen.getByRole("button", { name: "Probe 1" }));
      for (const name of ["probe", "linker"]) {
        const tab = screen.getByRole("tab", { name });
        await userEvent.click(within(tab).getByRole("button", { name: "Close tab" }));
      }
      expect(groups()).toEqual([[]]);
      // Back to the linker, closed last, as a preview; then to the probe, closed before it.
      expect(fireEvent.mouseUp(screen.getByText("Open a view:"), { button: 3 })).toBe(false);
      expect(await screen.findByRole("button", { name: "Probe 1" })).toBeInTheDocument();
      expect(groups()).toEqual([["linker*"]]);
      fireEvent.mouseUp(screen.getByRole("button", { name: "Probe 1" }), { button: 3 });
      expect(await screen.findByRole("button", { name: "probe?n=1" })).toBeInTheDocument();
      expect(groups()).toEqual([["probe*"]]);
    });

    it("keeps Forward in a Group left empty a moment by moving its View out", async () => {
      saveGrid([{ tabs: ["probe"] }, { tabs: ["linker"] }], "HORIZONTAL");
      const requests = serve({
        ...ROUTES,
        "GET /api/config": () => json({ settings: [setting("gui.keep_empty_groups", true)] }),
      });
      let dock: ReturnType<typeof useDock> = null;
      renderWithQueries(
        <ViewOpener>
          <Workbench />
          <DockOf
            found={(api) => {
              dock = api;
            }}
          />
        </ViewOpener>,
      );
      await waitFor(() =>
        expect(requests.map((request) => new URL(request.url).pathname)).toContain("/api/config"),
      );
      await nextFrame();
      const api = dock as unknown as NonNullable<ReturnType<typeof useDock>>;
      const group = (id: string) => api.groups.find((group) => group.id === id);
      await userEvent.click(await screen.findByRole("button", { name: "probe" })); // narrowed
      act(() => api.getPanel("probe")?.api.setActive());
      await userEvent.keyboard("{Alt>}{ArrowLeft}{/Alt}");
      expect(await screen.findByRole("button", { name: "probe" })).toBeInTheDocument();
      // Out to the other Group, as a drag does, and back: Group 1 is empty meanwhile.
      act(() => api.getPanel("probe")?.api.moveTo({ group: group("2") }));
      await nextFrame();
      const panels = () => api.groups.map((group) => group.panels.map((panel) => panel.id));
      expect(panels()).toEqual([[], ["linker", "probe"]]);
      act(() => api.getPanel("probe")?.api.moveTo({ group: group("1") }));
      await nextFrame();
      expect(panels()).toEqual([["probe"], ["linker"]]);
      act(() => api.getPanel("probe")?.api.setActive());
      await userEvent.keyboard("{Alt>}{ArrowRight}{/Alt}");
      expect(await screen.findByRole("button", { name: "probe?since=1h" })).toBeInTheDocument();
    });

    it("takes keys typed in a row as one step", async () => {
      VIEWS.typer = Typer;
      try {
        save("typer");
        await renderWorkbench();
        const go = (key: string) => userEvent.keyboard(`{Alt>}{${key}}{/Alt}`);
        const field = () => screen.getByRole("textbox", { name: "Text" });
        await userEvent.type(field(), "abc");
        await go("ArrowLeft");
        expect(field()).toHaveValue("");
        await go("ArrowRight");
        expect(field()).toHaveValue("abc");
        await go("ArrowLeft");
        await userEvent.type(field(), "x"); // another step, Forward gone
        await go("ArrowRight");
        expect(field()).toHaveValue("x");
        await go("ArrowLeft");
        expect(field()).toHaveValue("");
      } finally {
        delete VIEWS.typer;
      }
    });

    it("takes keys typed after leaving the field as another step", async () => {
      VIEWS.typer = Typer;
      try {
        save("typer");
        await renderWorkbench();
        const go = (key: string) => userEvent.keyboard(`{Alt>}{${key}}{/Alt}`);
        const field = () => screen.getByRole("textbox", { name: "Text" });
        await userEvent.type(field(), "ab");
        field().blur();
        await userEvent.type(field(), "c");
        await go("ArrowLeft");
        expect(field()).toHaveValue("ab");
        await go("ArrowLeft");
        expect(field()).toHaveValue("");
      } finally {
        delete VIEWS.typer;
      }
    });

    it("restores a preview as one", async () => {
      const { unmount } = await renderWorkbench();
      await altClick(screen.getByRole("button", { name: "Probe 1" }));
      await waitFor(() => expect(savedViews()).toHaveLength(2));
      unmount();
      await renderWorkbench();
      expect(groups()).toEqual([["linker"], ["probe*"]]);
    });
  });

  it("lets a View show other parameters in its Panel and name its tab, and saves both", async () => {
    VIEWS.probe = Probe;
    try {
      save("probe");
      await renderWorkbench();
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
    // Its search field says so; another, e.g. that of a picker, does not take Ctrl+F.
    VIEWS.searcher = () => (
      <>
        <SearchField label="Pick" value="" onChange={() => {}} />
        <SearchField label="Find" value="old" onChange={() => {}} byCtrlF />
      </>
    );
    VIEWS.probe = Probe;
    try {
      save("searcher", "probe");
      const { unmount } = await renderWorkbench();
      const field = (await screen.findByRole("searchbox", { name: "Find" })) as HTMLInputElement;
      await userEvent.click(screen.getByRole("tab", { name: "searcher" }));
      field.blur();
      expect(pressCtrlF().defaultPrevented).toBe(true); // taken from the browser
      expect(field).toHaveFocus();
      expect([field.selectionStart, field.selectionEnd]).toEqual([0, 3]);
      field.blur();
      expect(pressCtrlF("F").defaultPrevented).toBe(true); // with Caps Lock on
      expect(field).toHaveFocus();
      field.blur();
      expect(pressCtrlF("а").defaultPrevented).toBe(true); // on a Cyrillic layout, by its place
      expect(field).toHaveFocus();
      field.blur();
      expect(pressCtrlF("g").defaultPrevented).toBe(false); // a Latin letter, as typed
      expect(field).not.toHaveFocus();
      unmount();
      // The View of the search field behind another: Ctrl+F goes to the browser.
      save("probe", "searcher");
      await renderWorkbench();
      await userEvent.click(await screen.findByRole("tab", { name: "probe" }));
      expect(pressCtrlF().defaultPrevented).toBe(false);
    } finally {
      delete VIEWS.searcher;
      delete VIEWS.probe;
    }
  });

  it("presses the button opening the active Panel's search field on Ctrl+F, until it is open", async () => {
    VIEWS.opener = function Opener() {
      const [open, setOpen] = useState(false);
      const button = useKeyTarget(open ? undefined : "search");
      return open ? (
        <SearchField label="Find" value="" onChange={() => {}} byCtrlF autoFocus />
      ) : (
        <button ref={button} type="button" onClick={() => setOpen(true)}>
          Open
        </button>
      );
    };
    try {
      save("opener");
      await renderWorkbench();
      await screen.findByRole("button", { name: "Open" });
      await userEvent.click(screen.getByRole("tab", { name: "opener" }));
      expect(pressCtrlF().defaultPrevented).toBe(true);
      const field = await screen.findByRole("searchbox", { name: "Find" });
      await waitFor(() => expect(field).toHaveFocus());
      field.blur();
      pressCtrlF();
      expect(field).toHaveFocus();
    } finally {
      delete VIEWS.opener;
    }
  });

  it("offers Views in an empty Group", async () => {
    save("gone");
    await renderKeepingEmptyGroups();
    const [tab] = screen.getAllByRole("tab");
    await userEvent.click(within(tab as HTMLElement).getByRole("button", { name: "Close tab" }));
    expect(tabs()).toEqual([]);
    expect(screen.getByText("Open a view:")).toBeInTheDocument();
    const suggested = within(screen.getByRole("list")).getAllByRole("button");
    expect(suggested.map((choice) => choice.textContent)).toEqual(["Repositories", "Events"]);
    await userEvent.click(suggested[0] as HTMLElement);
    expect(tabs()).toEqual(["Repositories"]);
  });
});
