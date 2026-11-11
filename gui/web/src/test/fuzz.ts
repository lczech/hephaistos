// Fuzzed tests: the same tests, with the stand-in for the Server answering after random delays,
// so in any order, and every query refetched at random moments, as live hints and reconnects do.
// Off unless a seed is given (`scripts/test_gui_fuzzed.sh`): each test then draws from a
// generator of its own, seeded by that seed and its name, so a failure replays with its seed,
// as far as the order of its requests does not depend on time itself.

import type { QueryClient } from "@tanstack/react-query";
import { inject } from "vitest";

declare module "vitest" {
  interface ProvidedContext {
    fuzz: string; // the seed of a fuzzed run; empty if not fuzzed (`vitest.config.ts`)
  }
}

/** The seed of this run; empty if not fuzzed. */
export const FUZZ_SEED = inject("fuzz");
/** The longest an answer waits, in ms: long enough to fall behind a later request. */
const MAX_DELAY = 200;
/** How long between refetches at random, in ms: at least, and at most. Each cancels what is
 * being fetched, so more often than a few answers take would starve a list of several pages,
 * which live hints, seconds apart, never do. */
const REFETCH_EVERY = [300, 1500] as const;
/** How long a test waits for what it finds, in ms, when fuzzed: answers come later. */
export const FUZZED_WAIT = 3000;

// Timers of the page, kept before a test makes them fake, so that fuzzing never waits on those.
const later = globalThis.setTimeout.bind(globalThis);
const stop = globalThis.clearTimeout.bind(globalThis);

let random: (() => number) | null = null;
let exact = false;
const timers = new Set<ReturnType<typeof setTimeout>>();

/** A generator of numbers in [0, 1), from a 32-bit state (mulberry32). */
function generator(state: number): () => number {
  let a = state;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A 32-bit hash of `text` (FNV-1a). */
function hashed(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return hash >>> 0;
}

/** Starts fuzzing the test named `name`, if this run is fuzzed. */
export function beginFuzzing(name: string): void {
  random = FUZZ_SEED === "" ? null : generator(hashed(`${FUZZ_SEED}:${name}`));
  exact = false;
}

/** Ends fuzzing the test that ran: no refetch after it. */
export function endFuzzing(): void {
  for (const timer of timers) stop(timer);
  timers.clear();
  random = null;
}

/** For a test that counts what is asked, or when: no refetches at random in it. */
export function exactRequests(): void {
  exact = true;
}

/** Waits a random moment before an answer, if fuzzed. */
export async function delayed(): Promise<void> {
  if (random === null) return;
  const wait = random() * MAX_DELAY;
  await new Promise<void>((resolve) => {
    const timer = later(() => {
      timers.delete(timer);
      resolve();
    }, wait);
    timers.add(timer);
  });
}

/** Refetches every query of `client` at random moments until the test ends, if fuzzed. */
export function refetching(client: QueryClient): void {
  const next = () => {
    if (random === null) return;
    const [least, most] = REFETCH_EVERY;
    const timer = later(
      () => {
        timers.delete(timer);
        if (exact) return;
        void client.invalidateQueries();
        next();
      },
      least + random() * (most - least),
    );
    timers.add(timer);
  };
  next();
}
