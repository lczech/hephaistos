import { type Atom, createAtom } from "@tanstack/react-store";

const kept = new Map<string, Atom<unknown>>();

/**
 * A value kept in this browser under `key`, shared by all who ask for it, e.g. a kind of View's
 * Panels. `valid` makes what was saved a value again: what it can use of it, else a default.
 */
export function keptAtom<T>(key: string, valid: (saved: unknown) => T): Atom<T> {
  let atom = kept.get(key) as Atom<T> | undefined;
  if (atom === undefined) {
    atom = createAtom(valid(read(key)));
    atom.subscribe((changed) => write(key, changed));
    kept.set(key, atom as Atom<unknown>);
  }
  return atom;
}

/** Forgets the values asked for, to read them again from what is kept: for tests. */
export function forgetKept(): void {
  kept.clear();
}

function read(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null; // unreadable, or no storage
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // no storage: the value lasts as long as the page
  }
}
