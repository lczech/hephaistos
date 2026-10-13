import { describe, expect, it } from "vitest";
import { event } from "../../test/server";
import { machineText, priorityName, shortId, subjectText } from "./eventText";

describe("Event texts", () => {
  it("name priorities, and show unknown ones as numbers", () => {
    expect([10, 20, 30, 40, 25].map(priorityName)).toEqual([
      "low",
      "normal",
      "high",
      "urgent",
      "25",
    ]);
  });

  it("fall back to short IDs for subjects and Machines without names", () => {
    const unnamed = event(1, {
      subject: { id: "0199e000-0000-7000-8000-0000deadbeef", type: "clone", label: null },
      recorded_by: { id: "0199e000-0000-7000-8000-00000000feed", name: null },
    });
    expect(subjectText(unnamed)).toBe("deadbeef");
    expect(machineText(unnamed)).toBe("0000feed");
    expect(shortId("0199e000-0000-7000-8000-0000deadbeef")).toBe("deadbeef");
  });
});
