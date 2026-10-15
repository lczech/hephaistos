// What the Desktop lets its page do: where it may go, and which keys the window keeps.

/** Where a link or navigation from the page goes: on in the window, to the browser, or nowhere. */
export function destination(url: string, server: string | null): "window" | "browser" | "none" {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "none";
  }
  if (server !== null && parsed.origin === server) return "window";
  // Web pages only: never files, or links that start other programs.
  return parsed.protocol === "https:" || parsed.protocol === "http:" ? "browser" : "none";
}

export type KeyAction =
  | "reload"
  | "zoomIn"
  | "zoomOut"
  | "zoomReset"
  | "fullScreen"
  | "devTools"
  | "quit";

/** A key as Electron reports it before the page sees it. */
export interface Key {
  type: string;
  key: string;
  control: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

const PLAIN: Record<string, KeyAction> = { F5: "reload", F11: "fullScreen" };
const WITH_CONTROL: Record<string, KeyAction> = {
  r: "reload",
  "=": "zoomIn",
  "+": "zoomIn",
  "-": "zoomOut",
  "0": "zoomReset",
  q: "quit",
};
const WITH_CONTROL_SHIFT: Record<string, KeyAction> = { I: "devTools", "+": "zoomIn" };

/** What the window does for a key; all others go to the page, e.g. Ctrl+W to close a Panel. */
export function keyAction(key: Key): KeyAction | null {
  if (key.type !== "keyDown" || key.alt || key.meta) return null;
  if (!key.control) return key.shift ? null : (PLAIN[key.key] ?? null);
  return (key.shift ? WITH_CONTROL_SHIFT : WITH_CONTROL)[key.key] ?? null;
}
