import { EventEmitter } from "node:events";
import type { WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import { guard } from "./guard.js";

const SERVER = "http://127.0.0.1:8264";

/** WebContents as far as the guard uses them, with what it was told. */
function guarded() {
  const contents = new EventEmitter() as EventEmitter & {
    opening?: (details: { url: string }) => { action: string };
  };
  Object.assign(contents, {
    setWindowOpenHandler: (handler: typeof contents.opening) => {
      contents.opening = handler;
    },
  });
  const deps = {
    server: () => SERVER,
    openExternal: vi.fn(),
    act: vi.fn(),
    reconnect: vi.fn(),
  };
  guard(contents as unknown as WebContents, deps);
  const event = (fields: object = {}) => ({ preventDefault: vi.fn(), ...fields });
  return { contents, deps, event };
}

describe("the guard of the window", () => {
  it("keeps the page to its Server, web pages to the browser, and the rest nowhere", () => {
    const { contents, deps, event } = guarded();
    for (const [url, prevented, external] of [
      [`${SERVER}/#token=x`, false, false],
      ["https://example.org/", true, true],
      ["file:///etc/passwd", true, false],
      ["vscode://file/x", true, false],
    ] as const) {
      deps.openExternal.mockClear();
      const navigating = event({ url });
      contents.emit("will-navigate", navigating);
      expect(navigating.preventDefault).toHaveBeenCalledTimes(prevented ? 1 : 0);
      expect(deps.openExternal.mock.calls).toEqual(external ? [[url]] : []);
    }
  });

  it("opens no window: web pages, its Server too, go to the browser", () => {
    const { contents, deps } = guarded();
    for (const url of [`${SERVER}/`, "https://example.org/", "file:///etc/passwd"]) {
      expect(contents.opening?.({ url })).toEqual({ action: "deny" });
    }
    expect(deps.openExternal.mock.calls).toEqual([[`${SERVER}/`], ["https://example.org/"]]);
  });

  it("attaches no webview", () => {
    const { contents, event } = guarded();
    const attaching = event();
    contents.emit("will-attach-webview", attaching);
    expect(attaching.preventDefault).toHaveBeenCalled();
  });

  it("keeps its own keys from the page, and passes on the others", () => {
    const { contents, deps, event } = guarded();
    const input = { type: "keyDown", control: true, shift: false, alt: false, meta: false };
    const reload = event();
    contents.emit("before-input-event", reload, { ...input, key: "r" });
    expect(reload.preventDefault).toHaveBeenCalled();
    expect(deps.act).toHaveBeenCalledWith("reload", contents);
    const close = event();
    contents.emit("before-input-event", close, { ...input, key: "w" });
    expect(close.preventDefault).not.toHaveBeenCalled();
    expect(deps.act).toHaveBeenCalledTimes(1);
  });

  it("connects again when a load of its Server fails, not one replaced or elsewhere", () => {
    const { contents, deps } = guarded();
    const fail = (code: number, url: string, isMainFrame = true) =>
      contents.emit("did-fail-load", {}, code, "", url, isMainFrame);
    fail(-3, `${SERVER}/`); // replaced by a newer load
    fail(-102, "https://example.org/");
    fail(-102, `${SERVER}/frame`, false);
    expect(deps.reconnect).not.toHaveBeenCalled();
    fail(-102, `${SERVER}/`); // refused: the Daemon stopped
    expect(deps.reconnect).toHaveBeenCalledTimes(1);
  });
});
