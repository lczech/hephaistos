import { EventEmitter } from "node:events";
import type { WebContents } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Connector, LISTEN_WAIT, POLL, RETRY, type Steps, type Waiting } from "./connecting.js";
import { guard } from "./guard.js";
import type { Outcome } from "./hephaistos.js";

const LINK = "http://127.0.0.1:8264/#token=abc";
const ok = (output: string): Outcome => ({ ok: true, output });
const failed = (reason: string) => ({ ok: false, reason }) as const;
const down = ({ reason }: { reason: string }): Waiting => ({ state: "down", reason });
const DOWN = failed("the server is not running; see `hephaistos daemon status`");

/** A Connector whose hephaistos answers from lists, one answer per call of each command. */
function connector(answers: { link: Outcome[]; start?: Outcome[] }) {
  const loaded: string[] = [];
  const shown: Waiting[] = [];
  const calls: string[] = [];
  const steps: Steps = {
    run: async (args) => {
      const command = args.join(" ");
      calls.push(command);
      const list = command === "daemon start" ? (answers.start ?? []) : answers.link;
      return list.shift() ?? list.at(-1) ?? DOWN;
    },
    load: (link) => loaded.push(link),
    show: (waiting) => shown.push(waiting),
  };
  return { connecting: new Connector(steps), loaded, shown, calls };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("connecting", () => {
  it("loads the GUI when the Daemon runs", async () => {
    const { connecting, loaded, shown } = connector({ link: [ok(LINK)] });
    await connecting.now();
    expect(loaded).toEqual([LINK]);
    expect(shown).toEqual([]);
  });

  it("starts a Daemon that does not run, and loads the GUI once its Server listens", async () => {
    const { connecting, loaded, shown, calls } = connector({
      link: [DOWN, DOWN, ok(LINK)],
      start: [ok("The daemon runs (pid 7)")],
    });
    const done = connecting.now();
    await vi.advanceTimersByTimeAsync(2 * POLL);
    await done;
    expect(shown).toEqual([{ state: "starting" }]);
    expect(calls).toEqual([
      "daemon token --url",
      "daemon start",
      "daemon token --url",
      "daemon token --url",
    ]);
    expect(loaded).toEqual([LINK]);
  });

  it("says why it cannot start the Daemon, and keeps looking without starting it", async () => {
    const notInstalled = failed("the daemon is not installed; run `hephaistos daemon install`");
    const { connecting, loaded, shown, calls } = connector({
      link: [DOWN, DOWN, ok(LINK)],
      start: [notInstalled],
    });
    await connecting.now();
    expect(shown).toEqual([{ state: "starting" }, down(notInstalled)]);
    await vi.advanceTimersByTimeAsync(RETRY);
    expect(shown.at(-1)).toEqual(down(DOWN));
    await vi.advanceTimersByTimeAsync(RETRY);
    expect(loaded).toEqual([LINK]);
    expect(calls.filter((call) => call === "daemon start")).toHaveLength(1);
  });

  it("gives a started Daemon's Server some time to listen, then says why not", async () => {
    const { connecting, shown } = connector({ link: [DOWN], start: [ok("runs")] });
    const done = connecting.now();
    await vi.advanceTimersByTimeAsync(LISTEN_WAIT + POLL);
    await done;
    expect(shown).toEqual([{ state: "starting" }, down(DOWN)]);
  });

  it("starts anew when asked, ending the earlier tries", async () => {
    const { connecting, calls } = connector({
      link: [DOWN],
      start: [failed("not installed"), ok("runs")],
    });
    await connecting.now();
    void connecting.now();
    await vi.advanceTimersByTimeAsync(POLL);
    expect(calls.filter((call) => call === "daemon start")).toHaveLength(2);
    connecting.stop();
    const before = calls.length;
    await vi.advanceTimersByTimeAsync(LISTEN_WAIT + RETRY);
    expect(calls).toHaveLength(before);
  });

  it("loads again after a failed load at once, but not sooner than RETRY after its last", async () => {
    // The window, guarded: each load of the Server fails, as a page that keeps failing does.
    const contents = new EventEmitter();
    Object.assign(contents, { setWindowOpenHandler: () => undefined });
    const calls: string[] = [];
    const connecting = new Connector({
      run: async (args) => {
        calls.push(args.join(" "));
        return ok(LINK);
      },
      load: () => contents.emit("did-fail-load", {}, -102, "", LINK, true),
      show: () => undefined,
    });
    guard(contents as unknown as WebContents, {
      server: () => new URL(LINK).origin,
      openExternal: () => undefined,
      act: () => undefined,
      reconnect: () => void connecting.afterFailedLoad(),
    });
    await connecting.now();
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(RETRY - 1);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(10 * RETRY);
    expect(calls).toHaveLength(12);
    connecting.stop();
    // A load that fails long after the last, e.g. reloading once the Daemon stopped: at once.
    const later = new Connector({
      run: async (args) => {
        calls.push(args.join(" "));
        return ok(LINK);
      },
      load: () => undefined,
      show: () => undefined,
    });
    await later.now();
    calls.length = 0;
    await vi.advanceTimersByTimeAsync(RETRY);
    await later.afterFailedLoad();
    expect(calls).toEqual(["daemon token --url"]);
  });
});
