import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Schemas } from "../../api/client";
import { EVENTS_PAGE } from "../../api/queries";
import { event, info, json, renderWithQueries, serve } from "../../test/server";
import { EventsView } from "./EventsView";

type Event = Schemas["EventJson"];

/** A Server with these Events and as many Machines. */
function serveEvents(listed: Event[] | (() => Event[]), machines = 1): Request[] {
  const machine = { id: "01", name: "laptop" };
  return serve({
    "GET /api/info": () => json(info()),
    "GET /api/machines": () => json(Array.from({ length: machines }, () => machine)),
    "GET /api/events": () => json(typeof listed === "function" ? listed() : listed),
  });
}

/** The texts of a row's cells, after the chevron. */
function cells(row: HTMLElement): string[] {
  const button = within(row).getByRole("button");
  return [...button.querySelectorAll(":scope > span")].map((cell) => cell.textContent ?? "");
}

const committed = event(1, { details: [{ field: "head", text: "aaaaaaa → abc1" }] });
const added = event(2, {
  kind: "repository.added",
  priority: 20,
  subject: {
    id: "0199e000-0000-7000-8000-00000000dddd",
    type: "repository",
    name: "project",
    path: null,
  },
  summary: "",
});

describe("the Events View", () => {
  it("lists Events newest first, by action, Repository and subject", async () => {
    serveEvents([event(3, { priority: 30 }), added, committed]);
    renderWithQueries(<EventsView />);
    expect(await screen.findByText("Commit number 1 (abc1)")).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem"); // the header row is hidden from these
    expect(rows.map(cells).map((row) => row.slice(1))).toEqual([
      ["committed", "project", "~/project", "Commit number 3 (abc3)"],
      ["added", "project", "", ""], // a Repository's own Event: its name is already there
      ["committed", "project", "~/project", "Commit number 1 (abc1)"],
    ]);
    expect(rows.map((row) => row.dataset.priority)).toEqual(["high", "normal", "low"]);
    expect(within(rows[0] as HTMLElement).getByTitle("clone.committed")).toBeInTheDocument();
  });

  it("names the Machine only once there are several", async () => {
    serveEvents([committed], 2);
    renderWithQueries(<EventsView />);
    const [row] = await screen.findAllByRole("listitem");
    await vi.waitFor(() => expect(cells(row as HTMLElement)).toContain("laptop"));
  });

  it("opens an Event's details below it, and closes them again", async () => {
    serveEvents([committed]);
    renderWithQueries(<EventsView />);
    const row = await screen.findByRole("button", { expanded: false });
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

  it("opens and closes with the keyboard", async () => {
    serveEvents([committed]);
    renderWithQueries(<EventsView />);
    await screen.findByRole("button");
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText(committed.id)).toBeInTheDocument();
    await userEvent.keyboard(" ");
    expect(screen.queryByText(committed.id)).not.toBeInTheDocument();
  });

  it("keeps details open as new Events arrive", async () => {
    let listed = [committed];
    serveEvents(() => listed);
    const { client } = renderWithQueries(<EventsView />);
    await userEvent.click(await screen.findByRole("button"));
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
    renderWithQueries(<EventsView />);
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
    renderWithQueries(<EventsView />);
    expect(await screen.findByText("No Events yet.")).toBeInTheDocument();
  });
});
