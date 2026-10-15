import { describe, expect, it } from "vitest";
import { daemon, NOW, secondsAgo } from "../../test/server";
import { daemonText, lastPassText, serverText, watcherText } from "./daemonText";

describe("the Daemon card's lines", () => {
  it("say how the Daemon runs", () => {
    const { daemon: process } = daemon();
    expect(daemonText(process, NOW)).toBe("running, pid 4242, started 2h ago");
    expect(daemonText({ ...process, under_systemd: false }, NOW)).toMatch(/^running \(not under/);
    const stopped = { ...process, running: false, stopped_at: secondsAgo(300) };
    expect(daemonText(stopped, NOW)).toBe("not running; stopped 5m ago");
  });

  it("say how the last pass went", () => {
    const pass = {
      finished_at: secondsAgo(20),
      duration: 0.8,
      error: null,
      trigger: "api" as const,
    };
    expect(lastPassText(pass, NOW)).toBe("now (0.8 s), by API request");
    expect(lastPassText({ ...pass, error: "git is gone" }, NOW)).toBe(
      "now (0.8 s), by API request; failed: git is gone",
    );
    expect(lastPassText(null, NOW)).toBe("none yet");
  });

  it("say when the Watcher passes next", () => {
    const watcher = daemon().watcher;
    if (watcher === null) throw new Error("no Watcher");
    expect(watcherText(watcher, NOW)).toBe("every 60 s; next pass in 40 s");
    expect(watcherText({ ...watcher, last_pass: null }, NOW)).toBe(
      "every 60 s; first pass running",
    );
    expect(watcherText({ ...watcher, stalled: true }, NOW)).toBe(
      "every 60 s; stalled: last pass now",
    );
    expect(watcherText({ ...watcher, interval: 0 }, NOW)).toBe(
      "passes only on request (watcher.interval is 0)",
    );
  });

  it("say what the Server answered", () => {
    const server = daemon().server;
    if (server === null) throw new Error("no Server");
    expect(serverText(server, NOW)).toBe(
      "listening on 127.0.0.1:8264; 312 requests since start, last now; 1 live connection",
    );
    expect(serverText({ ...server, requests: 1, refused: 2, live: 0 }, NOW)).toBe(
      "listening on 127.0.0.1:8264; 1 request since start, last now; 2 refused",
    );
    expect(serverText({ ...server, last_request_at: null, live: 0 }, NOW)).toBe(
      "listening on 127.0.0.1:8264; no requests yet",
    );
  });
});
