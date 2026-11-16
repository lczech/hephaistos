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
  code: string; // the place of the key, as on a US keyboard: `KeyR`
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

/**
 * The Latin letter a key types, in lower case; where the letter typed is not Latin, e.g. on a
 * Cyrillic layout, that of its place on a US keyboard (`KeyR`), so that Ctrl+R still reloads.
 * Not by its place otherwise, which on AZERTY is that of another letter. As the page does.
 */
function letterOf(key: Key): string | undefined {
  const typed = key.key.toLowerCase();
  if (/^[a-z]$/.test(typed)) return typed;
  if (!/^\p{L}$/u.test(key.key)) return undefined;
  return /^Key([A-Z])$/.exec(key.code)?.[1]?.toLowerCase();
}

/** What the window does for a key; all others go to the page, e.g. Ctrl+W to close a Panel. */
export function keyAction(key: Key): KeyAction | null {
  if (key.type !== "keyDown" || key.alt || key.meta) return null;
  if (!key.control) return key.shift ? null : (PLAIN[key.key] ?? null);
  // A letter in the case Shift gives it, whatever Caps Lock makes of it; any other key as it is.
  const letter = letterOf(key);
  if (key.shift) return WITH_CONTROL_SHIFT[letter?.toUpperCase() ?? key.key] ?? null;
  return WITH_CONTROL[letter ?? key.key] ?? null;
}
