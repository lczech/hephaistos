import { describe, expect, it } from "vitest";
import { eventFilters, eventsTitle } from "./choices";

const PROJECT = "0199e000-0000-7000-8000-00000000dddd";
const since = [{ value: "1d", label: "last day" }];
const repository = [{ value: PROJECT, label: "project" }];

describe("the Events tab's title", () => {
  it("names what is filtered, in the columns' order", () => {
    expect(eventsTitle([], {})).toBe("Events");
    const filters = [
      { id: "recorded", value: ["1d"] },
      { id: "repository", value: [PROJECT] },
    ];
    expect(eventsTitle(filters, { recorded: since, repository })).toBe("Events: last day, project");
    expect(eventsTitle([{ id: "repository", value: [PROJECT, "0200"] }], { repository })).toBe(
      "Events: 2 repositories",
    );
  });

  it("waits for names still asked for, and counts more than two filters", () => {
    const filters = [
      { id: "recorded", value: ["1d"] },
      { id: "repository", value: [PROJECT] },
    ];
    expect(eventsTitle(filters, { recorded: since })).toBeUndefined();
    expect(eventsTitle([...filters, { id: "kind", value: ["clone"] }], {})).toBe(
      "Events: 3 filters",
    );
  });
});

describe("the Events filters", () => {
  it("are asked of the Server as its parameters, lists where it takes several", () => {
    expect(eventFilters({ kind: "clone", repository: [PROJECT, "0200"], since: "1d" })).toEqual({
      kind: ["clone"],
      repository: [PROJECT, "0200"],
      since: "1d",
    });
    expect(eventFilters({})).toEqual({});
  });
});
