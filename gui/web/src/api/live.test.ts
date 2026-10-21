import { act } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lastSocket } from "../test/live";
import { renderWithQueries, serve } from "../test/server";
import { takeTokenFromUrl, token } from "../token";
import {
  FIRST_DELAY,
  HINTED,
  LAST_DELAY,
  ON_CONNECT,
  ON_FOCUS,
  SILENCE,
  useConnection,
  useLiveUpdates,
} from "./live";
import { KEYS, type KeyName } from "./queries";

function Live() {
  useLiveUpdates();
  return createElement("p", { "data-testid": "connection" }, JSON.stringify(useConnection()));
}

function start() {
  const rendered = renderWithQueries(createElement(Live));
  const invalidated = vi.spyOn(rendered.client, "invalidateQueries");
  const connection = () => JSON.parse(rendered.getByTestId("connection").textContent ?? "");
  return { invalidated, connection };
}

const keysOf = (names: KeyName[]) => names.map((name) => [{ queryKey: KEYS[name] }]);

function wait(ms: number): void {
  act(() => vi.advanceTimersByTime(ms));
}

beforeEach(() => {
  vi.useFakeTimers();
  window.history.replaceState(null, "", "/#token=secret");
  takeTokenFromUrl();
  serve({ "POST /api/observe": () => new Response(null, { status: 204 }) });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the live connection", () => {
  it("sends the token first, then asks again for everything", () => {
    const { invalidated, connection } = start();
    expect(connection()).toEqual({ state: "connecting" });
    expect(lastSocket().url).toBe("ws://localhost:3000/api/live");
    invalidated.mockClear();
    act(() => lastSocket().open());
    expect(lastSocket().sent).toEqual([JSON.stringify({ token: "secret" })]);
    expect(invalidated.mock.calls).toEqual([[]]);
    expect(connection()).toEqual({ state: "live", since: Date.now() });
  });

  it("asks again for what each hint names, and only that", () => {
    const { invalidated } = start();
    act(() => lastSocket().open());
    invalidated.mockClear();
    act(() => lastSocket().receive({ hints: ["daemon", "log"] }));
    expect(invalidated.mock.calls).toEqual(keysOf(["daemon", "log"]));
    invalidated.mockClear();
    act(() => lastSocket().receive({ heartbeat: new Date().toISOString() }));
    expect(invalidated).not.toHaveBeenCalled();
  });

  it("counts as lost after a silence, and reconnects", () => {
    const { connection } = start();
    act(() => lastSocket().open());
    wait(SILENCE - 5_000);
    act(() => lastSocket().receive({ heartbeat: new Date().toISOString() }));
    wait(SILENCE - 1_000);
    expect(connection().state).toBe("live");
    const silent = lastSocket();
    wait(2_000);
    expect(silent.closed).toBe(true);
    expect(connection()).toMatchObject({ state: "disconnected", since: Date.now() });
    wait(FIRST_DELAY);
    expect(lastSocket()).not.toBe(silent);
  });

  it("tries again ever later, and from the start once connected", () => {
    const { connection } = start();
    const delays: number[] = [];
    for (let attempt = 0; attempt < 7; attempt++) {
      act(() => lastSocket().drop());
      const { retryAt } = connection();
      delays.push(retryAt - Date.now());
      wait(retryAt - Date.now());
    }
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, LAST_DELAY, LAST_DELAY]);
    act(() => lastSocket().open());
    act(() => lastSocket().drop());
    expect(connection().retryAt - Date.now()).toBe(FIRST_DELAY);
  });

  it("stays disconnected since it was first lost", () => {
    const { connection } = start();
    act(() => lastSocket().open());
    act(() => lastSocket().drop());
    const since = Date.now();
    wait(FIRST_DELAY);
    act(() => lastSocket().drop());
    expect(connection()).toMatchObject({ state: "disconnected", since });
  });

  it("reconnects at once when the page gains focus", () => {
    start();
    act(() => lastSocket().drop());
    const lost = lastSocket();
    act(() => window.dispatchEvent(new Event("focus")));
    expect(lastSocket()).not.toBe(lost);
  });

  it("forgets a token the Server refuses", () => {
    start();
    act(() => lastSocket().open());
    act(() => lastSocket().drop(4401, "wrong token"));
    expect(token()).toBeNull();
  });

  it("keeps a newer token than the one refused", () => {
    start();
    act(() => lastSocket().open());
    window.history.replaceState(null, "", "/#token=renewed");
    takeTokenFromUrl();
    act(() => lastSocket().drop(4401, "wrong token"));
    expect(token()).toBe("renewed");
  });

  it("asks again on focus for what no hint covers", () => {
    const { invalidated } = start();
    invalidated.mockClear();
    wait(60_000); // past the gap since the page opened
    act(() => window.dispatchEvent(new Event("focus")));
    expect(invalidated.mock.calls).toEqual(keysOf(ON_FOCUS));
  });

  it("asks again when the page is shown, as when its window gains focus", () => {
    const { invalidated } = start();
    invalidated.mockClear();
    wait(60_000);
    act(() => document.dispatchEvent(new Event("visibilitychange", { bubbles: true })));
    expect(invalidated.mock.calls).toEqual(keysOf(ON_FOCUS));
  });

  it("keeps every query current somehow", () => {
    const covered = new Set([...Object.values(HINTED).flat(), ...ON_FOCUS, ...ON_CONNECT]);
    expect(Object.keys(KEYS).filter((name) => !covered.has(name as KeyName))).toEqual([]);
  });
});
