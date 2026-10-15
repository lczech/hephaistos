import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Connector, LISTEN_WAIT, POLL, RETRY, type Steps, type Waiting } from "./connecting.js";
import type { Outcome } from "./hephaistos.js";

const LINK = "http://127.0.0.1:8264/#token=abc";
const ok = (output: string): Outcome => ({ ok: true, output });
const failed = (reason: string) => ({ ok: false, reason }) as const;
const down = ({ reason }: { reason: string }): Waiting => ({ state: "down", reason });
const DOWN = failed("the Server isn't running; see `hephaistos daemon status`");

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

  it("starts a Daemon that doesn't run, and loads the GUI once its Server listens", async () => {
    const { connecting, loaded, shown, calls } = connector({
      link: [DOWN, DOWN, ok(LINK)],
      start: [ok("The Daemon runs (pid 7)")],
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

  it("says why it can't start the Daemon, and keeps looking without starting it", async () => {
    const notInstalled = failed("the Daemon isn't installed; run `hephaistos daemon install`");
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
});
