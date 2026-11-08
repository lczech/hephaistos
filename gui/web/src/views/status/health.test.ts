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
    const checks = {
      checked_at: new Date(NOW).toISOString(),
      checks: [
        { name: "git", outcome: "ok" as const, text: "2.43.0", fix: null },
        { name: "unit", outcome: "problem" as const, text: "HEPHAISTOS_HOME differs", fix: null },
        { name: "ionice", outcome: "note" as const, text: "not installed", fix: null },
      ],
    };
    const troubled = { ...status, watcher, checks };
    expect(daemonHealth(live, troubled, NOW)).toEqual({
      health: "warning",
      reasons: [
        "unit: HEPHAISTOS_HOME differs",
        "last pass failed: disk full",
        "the watcher has stalled",
      ],
    });
  });

  it("warns of what the last pass could not observe, until a pass without", () => {
    const status = daemon();
    const pass = status.watcher?.last_pass;
    if (!status.watcher || !pass) throw new Error("no last pass");
    const problems = ["terminals not observed: tmux is gone"];
    const troubled = {
      ...status,
      watcher: { ...status.watcher, last_pass: { ...pass, problems } },
    };
    expect(daemonHealth(live, troubled, NOW)).toEqual({
      health: "warning",
      reasons: ["last pass: terminals not observed: tmux is gone"],
    });
    expect(daemonHealth(live, status, NOW).health).toBe("good");
  });

  it("warns of a GUI that does not fit the API, as a problem of the setup", () => {
    const hint = "This GUI is built for API 0.22; the daemon runs 0.21: restart it";
    expect(daemonHealth(live, daemon(), NOW, hint)).toEqual({ health: "warning", reasons: [hint] });
    expect(daemonHealth(live, undefined, NOW, hint).health).toBe("warning");
    expect(daemonHealth({ state: "connecting" }, undefined, NOW, hint).health).toBe("waiting");
  });
});
