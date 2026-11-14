// Following the token file of the Daemon: a renewed token is a new link to load.

import { basename, dirname } from "node:path";

export const SETTLE = 200; // ms after the token file changes, before reading it

/** How the file is watched and read: Node's, or stand-ins. */
export interface Watching {
  watch: (directory: string, listener: (event: string, name: string | null) => void) => unknown;
  read: (path: string) => string | null;
}

/**
 * Calls `changed` once its text changed, a moment after the last change of the file, as a write
 * may come in parts. Watched by its directory, as a file written anew is another file.
 */
export function followToken(file: string, changed: () => void, { watch, read }: Watching): void {
  let last = read(file);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    watch(dirname(file), (_event, name) => {
      if (name !== basename(file)) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const current = read(file);
        if (current === last) return;
        last = current;
        changed();
      }, SETTLE);
    });
  } catch {
    // No data directory yet: `hephaistos setup` makes it, and then the Desktop starts anew.
  }
}
