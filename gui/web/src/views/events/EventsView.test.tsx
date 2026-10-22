import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Schemas } from "../../api/client";
import { EVENTS_PAGE } from "../../api/queries";
import { columnWidths } from "../../components/table/widths";
import { cells } from "../../test/list";
import { clone, event, info, json, renderWithQueries, repository, serve } from "../../test/server";
import { addressText, type Params } from "../address";
import { EventsView } from "./EventsView";

type Event = Schemas["EventJson"];

const PROJECT = "0199e000-0000-7000-8000-00000000dddd";
const KINDS = ["machine.registered", "clone.registered", "clone.committed", "clone.missing"];

/** A Server with these Events and as many Machines. */
function serveEvents(listed: Event[] | (() => Event[]), machines = 1): Request[] {
  const machine = { id: "01", name: "laptop" };
  return serve({
    "GET /api/info": () => json(info()),
    "GET /api/machines": () => json(Array.from({ length: machines }, () => machine)),
    "GET /api/repositories": () => json([{ id: PROJECT, name: "project" }]),
    "GET /api/events/kinds": () => json(KINDS.map((kind) => ({ kind, priority: 20 }))),
    "GET /api/events": () => json(typeof listed === "function" ? listed() : listed),
  });
}

const setTitle = vi.fn<(title: string) => void>();
beforeEach(() => setTitle.mockClear());

/** The View as a Panel holds it: with its parameters, here shown as its address. */
function Events({ at = {} }: { at?: Params }) {
  const [params, setParams] = useState(at);
  return (
    <>
      <output>{addressText({ kind: "events", params })}</output>
      <EventsView params={params} setParams={setParams} setTitle={setTitle} />
    </>
  );
}

// An Event's row, its details closed: not a filter's funnel, which opens a menu.
const closedRow = () =>
  screen.findByRole("button", { expanded: false, name: (name) => !name.startsWith("Filter by") });

const address = () => screen.getByRole("status").textContent;
/** What the last request for Events asked to filter by. */
const asked = (requests: Request[]) =>
  new URL(requests.findLast((request) => request.url.includes("/api/events?"))?.url ?? "")
    .searchParams;

/** The texts of a row's cells, after the priority's square. */
const committed = event(1, { details: [{ field: "head", text: "aaaaaaa → abc1" }] });
const added = event(2, {
  kind: "repository.registered",
  priority: 20,
  subject: {
    id: PROJECT,
    type: "repository",
    name: "project",
    path: null,
  },
  summary: "",
});

describe("the Events View", () => {
  it("lists Events newest first, by action, Repository and subject", async () => {
    serveEvents([event(3, { priority: 30 }), added, committed]);
    renderWithQueries(<Events />);
    expect(await screen.findByText("Commit number 1 (abc1)")).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(rows.map(cells).map((row) => row.slice(1))).toEqual([
      ["committed", "project", "~/project", "Commit number 3 (abc3)"],
      ["registered", "project", "", ""], // a Repository's own Event: its name is already there
      ["committed", "project", "~/project", "Commit number 1 (abc1)"],
    ]);
    expect(rows.map((row) => row.dataset.tone)).toEqual(["warning", undefined, "muted"]);
    expect(within(rows[0] as HTMLElement).getByTitle("high priority")).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByTitle("clone.committed")).toBeInTheDocument();
  });

  it("names the Machine only once there are several", async () => {
    serveEvents([committed], 2);
    renderWithQueries(<Events />);
    const [row] = await screen.findAllByRole("listitem");
    await vi.waitFor(() => expect(cells(row as HTMLElement)).toContain("laptop"));
  });

  it("opens an Event's details below it, and closes them again", async () => {
    serveEvents([committed]);
    renderWithQueries(<Events />);
    const row = await closedRow();
    await userEvent.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    const details = screen.getByRole("region", { name: "Event details" });
    expect(row).toHaveAttribute("aria-controls", details.id);
    expect(within(details).getByText(committed.id)).toBeInTheDocument();
    expect(within(details).getByText("aaaaaaa → abc1")).toBeInTheDocument();
    expect(within(details).getByText("~/project")).toBeInTheDocument();
    await userEvent.click(row);
    expect(screen.queryByText(committed.id)).not.toBeInTheDocument();
  });

  it("shows a commit Event's commit, its message whole, with a link to its changes", async () => {
    const hash = "abc1".padEnd(40, "0");
    const withBody = event(1, {
      details: [
        { field: "subject", text: "Fix it" },
        { field: "body", text: "Why." },
      ],
      payload: { head: { old: null, new: hash }, subject: "Fix it", body: "Why.\n\nAnd how." },
    });
    serveEvents([withBody]);
    renderWithQueries(<Events />);
    await userEvent.click(await closedRow());
    const details = screen.getByRole("region", { name: "Event details" });
    expect(within(details).getByText(/^Why\./)).toHaveTextContent("Why. And how.");
    expect(within(details).queryByText("body")).toBeNull(); // the box says it whole
    expect(
      within(details).getByRole("button", { name: "Changes in commit abc1000" }),
    ).toBeInTheDocument();
  });

  it("opens and closes with the keyboard", async () => {
    serveEvents([committed]);
    renderWithQueries(<Events />);
    (await closedRow()).focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText(committed.id)).toBeInTheDocument();
    await userEvent.keyboard(" ");
    expect(screen.queryByText(committed.id)).not.toBeInTheDocument();
  });

  it("keeps details open as new Events arrive", async () => {
    let listed = [committed];
    serveEvents(() => listed);
    const { client } = renderWithQueries(<Events />);
    await userEvent.click(await closedRow());
    listed = [event(2), committed];
    await act(() => client.invalidateQueries());
    expect(await screen.findByText("Commit number 2 (abc2)")).toBeInTheDocument();
    expect(screen.getByText(committed.id)).toBeInTheDocument();
  });

  it("loads older Events on scrolling to the end, from the oldest shown", async () => {
    let scrolledToEnd = () => {};
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(seen: IntersectionObserverCallback) {
          scrolledToEnd = () =>
            seen([{ isIntersecting: true }] as IntersectionObserverEntry[], this as never);
        }
        observe() {}
        disconnect() {}
      },
    );
    const newest = Array.from({ length: EVENTS_PAGE }, (_, i) => event(EVENTS_PAGE + 1 - i));
    const requests = serveEvents(() =>
      requests.at(-1)?.url.includes("before=") ? [event(1)] : newest,
    );
    renderWithQueries(<Events />);
    expect(await screen.findByText("Older Events load as you scroll.")).toBeInTheDocument();
    act(() => scrolledToEnd());
    expect(await screen.findByText("Commit number 1 (abc1)")).toBeInTheDocument();
    const older = new URL(requests.at(-1)?.url ?? "").searchParams;
    expect(older.get("before")).toBe(event(2).id);
    expect(older.get("limit")).toBe(String(EVENTS_PAGE));
    expect(screen.queryByText(/Older Events/)).not.toBeInTheDocument();
  });

  it("says when there are none", async () => {
    serveEvents([]);
    renderWithQueries(<Events />);
    expect(await screen.findByText("No Events yet.")).toBeInTheDocument();
  });
});

describe("the Events View's columns", () => {
  afterEach(() => columnWidths("events").set({}));

  const grid = (list: HTMLElement) => list.parentElement?.style.getPropertyValue("--columns");
  /** The columns, all as wide as at first but the time of recording. */
  const columns = (recorded: number) =>
    `var(--square) minmax(40px, ${recorded}px) minmax(40px, 140px) minmax(40px, 120px) ` +
    "minmax(40px, 200px) minmax(8rem, 1fr)";

  it("resize by dragging their edge, in every Events View, and are kept", async () => {
    serveEvents([committed]);
    renderWithQueries(
      <>
        <Events />
        <Events />
      </>,
    );
    await screen.findAllByText("Commit number 1 (abc1)");
    const lists = screen.getAllByRole("list");
    expect(lists.map(grid)).toEqual([columns(88), columns(88)]);
    const [recorded] = screen.getAllByRole("separator");
    fireEvent.mouseDown(recorded as HTMLElement, { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 130 });
    fireEvent.mouseUp(document, { clientX: 130 });
    expect(lists.map(grid)).toEqual([columns(118), columns(118)]);
    expect(localStorage.getItem("hephaistos.columns.events")).toBe('{"recorded":118}');
    fireEvent.doubleClick(recorded as HTMLElement);
    expect(grid(lists[0] as HTMLElement)).toBe(columns(88));
  });

  it("include the Machine's once there are several", async () => {
    serveEvents([committed], 2);
    renderWithQueries(<Events />);
    const list = await screen.findByRole("list");
    await vi.waitFor(() => expect(grid(list)).toContain("minmax(40px, 120px) minmax(40px, 120px)"));
  });
});

describe("the Events View's filters", () => {
  // Opened as by the user; while open, the rest of the page is hidden from queries by role.
  const open = (column: string) =>
    userEvent.click(screen.getByRole("button", { name: `Filter by ${column}` }));
  const close = () => userEvent.keyboard("{Escape}");

  it("are its parameters, which the Server filters by", async () => {
    const requests = serveEvents([committed]);
    renderWithQueries(
      <Events
        at={{ repository: PROJECT, kind: ["machine", "clone.registered"], priority: "high" }}
      />,
    );
    expect(await screen.findByText("Commit number 1 (abc1)")).toBeInTheDocument();
    expect(asked(requests).getAll("kind")).toEqual(["machine", "clone.registered"]);
    expect(asked(requests).getAll("repository")).toEqual([PROJECT]);
    expect(asked(requests).get("priority")).toBe("high");
    expect(await screen.findByText("repository: project")).toBeInTheDocument();
    expect(screen.getByText("kind: 2 kinds")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter by priority" })).toHaveAttribute(
      "title",
      "priority: high+",
    );
    await open("kind");
    expect(screen.getByRole("checkbox", { name: "machine.registered" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "clone.registered" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "clone.missing" })).not.toBeChecked();
    await close();
    expect(setTitle).toHaveBeenLastCalledWith("Events: 3 filters");
  });

  it("change with a column's choices, and clear", async () => {
    const requests = serveEvents([committed]);
    renderWithQueries(<Events />);
    await screen.findByText("Commit number 1 (abc1)");
    expect(setTitle).toHaveBeenLastCalledWith("Events");
    await open("repository");
    await userEvent.click(await screen.findByRole("checkbox", { name: "project" }));
    await close();
    expect(address()).toBe(`events?repository=${PROJECT}`);
    await vi.waitFor(() => expect(asked(requests).get("repository")).toBe(PROJECT));
    expect(setTitle).toHaveBeenLastCalledWith("Events: project");

    await open("recorded");
    expect(screen.getByRole("menuitemradio", { name: "all" })).toBeChecked();
    await userEvent.click(screen.getByRole("menuitemradio", { name: "last day" }));
    // Choosing one closes the menu.
    expect(screen.queryByRole("menu")).toBeNull();
    expect(address()).toBe(`events?repository=${PROJECT}&since=1d`);
    expect(setTitle).toHaveBeenLastCalledWith("Events: last day, project");

    await open("kind");
    await userEvent.click(screen.getByRole("checkbox", { name: "clone" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "clone.registered" }));
    await close();
    // Closing gives the focus back to the funnel.
    await vi.waitFor(() =>
      expect(screen.getByRole("button", { name: "Filter by kind" })).toHaveFocus(),
    );
    expect(address()).toBe(
      `events?kind=clone.committed&kind=clone.missing&repository=${PROJECT}&since=1d`,
    );
    await open("kind");
    await userEvent.click(screen.getByRole("button", { name: "Only machine" }));
    await close();
    expect(address()).toBe(`events?kind=machine&repository=${PROJECT}&since=1d`);

    await userEvent.click(screen.getByRole("button", { name: "Clear all filters" }));
    expect(address()).toBe("events");
    // Unfiltered, as first asked for: kept current by hints, so not asked again.
    expect(await screen.findByText("Commit number 1 (abc1)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear all filters" })).not.toBeInTheDocument();
  });

  it("stay to be changed when no Events match", async () => {
    serveEvents([]);
    renderWithQueries(<Events at={{ since: "1h" }} />);
    expect(await screen.findByText("No Events match.")).toBeInTheDocument();
    await open("recorded");
    await userEvent.click(screen.getByRole("menuitemradio", { name: "all" }));
    expect(address()).toBe("events");
    expect(await screen.findByText("No Events yet.")).toBeInTheDocument();
  });

  it("take a Clone from a link, by its path, until removed", async () => {
    const requests = serve({
      "GET /api/info": () => json(info()),
      "GET /api/machines": () => json([{ id: "01", name: "laptop" }]),
      "GET /api/repositories": () => json([repository("proj", [clone("proj")])]),
      "GET /api/events/kinds": () => json([]),
      "GET /api/events": () => json([]),
    });
    renderWithQueries(<Events at={{ clone: "clone-proj" }} />);
    expect(await screen.findByText("subject: ~/proj")).toBeInTheDocument();
    expect(asked(requests).get("clone")).toBe("clone-proj");
    await userEvent.click(screen.getByRole("button", { name: "Clear all filters" }));
    expect(address()).toBe("events");
    expect(screen.queryByRole("button", { name: "Filter by subject" })).toBeNull();
  });

  it("keep other parameters, and say what the Server refuses", async () => {
    serve({ "GET /api/events": () => json({ error: "since: 'soon' is no time" }, 400) });
    renderWithQueries(<Events at={{ since: "soon", other: "kept" }} />);
    expect(await screen.findByText("Couldn't load: since: 'soon' is no time")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear all filters" }));
    expect(address()).toBe("events?other=kept");
  });
});
