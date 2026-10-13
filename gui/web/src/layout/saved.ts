import type { SerializedDockview } from "dockview-react";

const KEY = "hephaistos.layout";
const FORMAT = 1; // a saved Layout in another format is dropped for the default one

interface Saved {
  format: number;
  dock: SerializedDockview;
}

/** The Layout this browser saved, if it can still be read. */
export function savedLayout(): SerializedDockview | null {
  try {
    const saved: Partial<Saved> | null = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return saved?.format === FORMAT && saved.dock ? saved.dock : null; // dockview checks the rest
  } catch {
    return null; // unreadable, or no storage
  }
}

export function saveLayout(dock: SerializedDockview): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ format: FORMAT, dock } satisfies Saved));
  } catch {
    // no storage: the Layout lasts as long as the page
  }
}
