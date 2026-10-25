import { describe, expect, it } from "vitest";
import type { Connection } from "../../api/live";
import { daemon, NOW } from "../../test/server";
import { daemonHealth } from "./health";

const live: Connection = { state: "live", since: NOW };

describe("the Daemon's health", () => {
  it("is lost while disconnected, waiting until connected, good without problems", () => {
    const lost: Connection = { state: "disconnected", since: NOW - 180_000, retryAt: NOW };
    expect(daemonHealth(lost, daemon(), NOW)).toEqual({
      health: "lost",
      reasons: ["disconnected 3m ago"],
    });
    const now: Connection = { ...lost, since: NOW };
    expect(daemonHealth(now, daemon(), NOW).reasons).toEqual(["disconnected"]);
    expect(daemonHealth({ state: "connecting" }, undefined, NOW).health).toBe("waiting");
    expect(daemonHealth(live, daemon(), NOW)).toEqual({ health: "good", reasons: ["running"] });
  });

  it("warns with each problem the Daemon reports", () => {
    const status = daemon();
    const watcher = status.watcher && {
      ...status.watcher,
      stalled: true,
      last_pass: status.watcher.last_pass && { ...status.watcher.last_pass, error: "disk full" },
    };
    const troubled = { ...status, watcher, warnings: ["HEPHAISTOS_HOME differs"] };
    expect(daemonHealth(live, troubled, NOW)).toEqual({
      health: "warning",
      reasons: [
        "HEPHAISTOS_HOME differs",
        "last pass failed: disk full",
        "the watcher has stalled",
      ],
    });
  });
});
