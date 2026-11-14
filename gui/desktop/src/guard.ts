// What the window lets its page do, wired to its WebContents: where it may go, which keys it
// keeps, and loading again when a load of the Server fails.

import type { WebContents } from "electron";
import { destination, type KeyAction, keyAction } from "./rules.js";

const ABORTED = -3; // a load that a newer one replaced

/** What the guard acts through. */
export interface Guarding {
  server: () => string | null; // the origin of the Server whose GUI the window shows
  openExternal: (url: string) => void; // in the user's browser
  act: (action: KeyAction, contents: WebContents) => void;
  reconnect: () => void;
}

/** Keeps the page to the Server and our keys; other web pages open in the user's browser. */
export function guard(contents: WebContents, { server, openExternal, act, reconnect }: Guarding) {
  contents.on("will-navigate", (event) => {
    const where = destination(event.url, server());
    if (where === "window") return;
    event.preventDefault();
    if (where === "browser") openExternal(event.url);
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (destination(url, server()) !== "none") openExternal(url);
    return { action: "deny" };
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.on("before-input-event", (event, input) => {
    const action = keyAction(input);
    if (action === null) return;
    event.preventDefault();
    act(action, contents);
  });
  // E.g. reloading while the Daemon is stopped: start it.
  contents.on("did-fail-load", (_event, code, _description, url, isMainFrame) => {
    const at = server();
    if (isMainFrame && code !== ABORTED && at !== null && url.startsWith(at)) reconnect();
  });
}
