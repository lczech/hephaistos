// What the window lets its page do: no Node, no permissions; and, wired to its WebContents, where
// it may go, which keys it keeps, and loading again when a load of the Server fails.

import type { Session, WebContents } from "electron";
import { destination, type KeyAction, keyAction } from "./rules.js";

const ABORTED = -3; // a load that a newer one replaced

/** Electron's defaults, stated: the page gets no Node and runs in Chromium's sandbox. */
export const WEB_PREFERENCES = { sandbox: true, contextIsolation: true, nodeIntegration: false };

/** Every permission the page asks for is refused, e.g. the camera or notifications. */
export function refusePermissions(session: Session): void {
  session.setPermissionRequestHandler((_contents, _name, answer) => answer(false));
  session.setPermissionCheckHandler(() => false);
}

/** What the guard acts through. */
export interface Guarding {
  server: () => string | null; // the origin of the Server whose GUI the window shows
  openExternal: (url: string) => void; // in the user's browser
  act: (action: KeyAction, contents: WebContents) => void;
  reconnect: () => void; // after a load of the Server failed
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
