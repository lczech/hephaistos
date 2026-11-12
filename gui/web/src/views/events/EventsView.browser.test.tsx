import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { linesOf, listRows } from "../../test/list";
import { event, info, json, renderWithQueries, serve } from "../../test/server";
import { expectSettled, InPanel } from "../../test/view";
import { EventsView } from "./EventsView";

// How the Events View lays out its rows, as a browser draws it: its styles select the List's rows,
// which only a browser applies.

/** The View, in a Panel this wide, with an Event of two Machines'. */
async function events() {
  serve({
    "GET /api/info": () => json(info()),
    "GET /api/machines": () =>
      json([
        { id: "01", name: "laptop" },
        { id: "02", name: "server" },
      ]),
    "GET /api/repositories": () => json([]),
    "GET /api/events/kinds": () => json([{ kind: "clone.committed", priority: 20 }]),
    "GET /api/events": () => json([event(1)]),
  });
  renderWithQueries(
    <div style={{ width: 700 }}>
      <InPanel view={EventsView} kind="events" />
    </div>,
  );
  await screen.findByText("Commit number 1 (abc1)");
  await expectSettled();
}

const box = (element: Element | null) => {
  if (element === null) throw new Error("not shown");
  return element.getBoundingClientRect();
};
const middle = (element: Element | null) => box(element).left + box(element).width / 2;

describe("the Events View, drawn", () => {
  it("in columns, puts the funnel of the priorities' square over the chevrons below", async () => {
    localStorage.setItem("hephaistos.lists.events.layout", '"columns"');
    await events();
    const funnel = screen.getByRole("button", { name: "Filter by priority" });
    const chevron = listRows()[0]?.querySelector("svg") ?? null;
    expect(middle(funnel.querySelector("svg"))).toBeCloseTo(middle(chevron), 1);
    // Within its header, not over the edge of the list.
    expect(box(funnel).left).toBeGreaterThanOrEqual(
      box(funnel.closest("[role=columnheader]")).left,
    );
  });

  it("in two lines, puts what happened first, where and when below it", async () => {
    localStorage.setItem("hephaistos.lists.events.layout", '"lines"');
    await events();
    const [row] = listRows();
    expect(linesOf(row as HTMLElement)).toEqual([
      ["priority", "kind", "repository", "summary"],
      ["machine", "subject", "recorded"],
    ]);
  });
});
