import { act, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EVENTS_PAGE } from "../../api/queries";
import { event, json, renderWithQueries, serve } from "../../test/server";
import { EventsView } from "./EventsView";

describe("the Events View", () => {
  it("lists Events newest first, with their summaries", async () => {
    serve({
      "GET /api/events": () =>
        json([event(2, { priority: 30, summary: "feature from aaaaaaa" }), event(1)]),
    });
    renderWithQueries(<EventsView />);
    expect(await screen.findByText("feature from aaaaaaa")).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem"); // the header row is hidden from these
    expect(rows.map((row) => [...row.children].slice(1).map((cell) => cell.textContent))).toEqual([
      ["laptop", "clone.committed", "/home/me/project", "feature from aaaaaaa"],
      ["laptop", "clone.committed", "/home/me/project", "Commit number 1 (abc1)"],
    ]);
    expect(rows.map((row) => row.dataset.priority)).toEqual(["high", "low"]);
    expect(screen.queryByText(/Older Events/)).not.toBeInTheDocument();
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
    const requests = serve({
      "GET /api/events": () => json(requests.at(-1)?.url.includes("before=") ? [event(1)] : newest),
    });
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
    serve({ "GET /api/events": () => json([]) });
    renderWithQueries(<EventsView />);
    expect(await screen.findByText("No Events yet.")).toBeInTheDocument();
  });
});
