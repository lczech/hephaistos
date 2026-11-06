// A short notice of what was just done, e.g. a path copied, shown in the status bar for a while.

import { createAtom } from "@tanstack/react-store";

export const NOTICE_TIME = 3000; // how long a notice shows, in milliseconds

/** The notice shown, if any. */
export const noticeAtom = createAtom<string | null>(null);

let clearing: ReturnType<typeof setTimeout> | undefined;

/** Shows `text` in the status bar for a while, instead of the one before. */
export function notify(text: string): void {
  noticeAtom.set(text);
  clearTimeout(clearing);
  clearing = setTimeout(() => noticeAtom.set(null), NOTICE_TIME);
}

/** Copies `text` to the clipboard, saying so, or that it could not. */
export async function copyText(text: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    notify(`Copied ${what}`);
  } catch {
    notify(`Could not copy ${what}`);
  }
}
