import { describe, expect, it } from "vitest";
import { daemon } from "../../test/server";
import { daemonHealth } from "./health";

describe("the Daemon's health", () => {
  it("is lost without an answer, waiting before the first, good without problems", () => {
    expect(daemonHealth(true, "Failed to fetch", daemon())).toEqual({
      health: "lost",
      reasons: ["no answer: Failed to fetch"],
    });
    expect(daemonHealth(false, null, undefined).health).toBe("waiting");
    expect(daemonHealth(true, null, daemon())).toEqual({ health: "good", reasons: ["running"] });
  });

  it("warns with each problem the Daemon reports", () => {
    const status = daemon();
    const watcher = status.watcher && {
      ...status.watcher,
      stalled: true,
      last_pass: status.watcher.last_pass && { ...status.watcher.last_pass, error: "disk full" },
    };
    const troubled = { ...status, watcher, warnings: ["HEPHAISTOS_HOME differs"] };
    expect(daemonHealth(true, null, troubled)).toEqual({
      health: "warning",
      reasons: [
        "HEPHAISTOS_HOME differs",
        "last pass failed: disk full",
        "the Watcher has stalled",
      ],
    });
  });
});
