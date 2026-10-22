// Finding runs in a worker, so that the page stays responsive and a regular expression that takes
// too long (e.g. `(a+)+$` on many a's) can be stopped: JS can't interrupt one, but a worker can
// be ended. Where there are no workers, as in WebKit's tests (`test/browser.ts`), on the page.
import FindWorker from "./find.worker.ts?worker";
import { findMatches, type Match, type Pattern } from "./pattern";

export const LIMIT = 10_000; // matches found at most; beyond, it says there are more
const TIMEOUT = 5_000; // ms a search may take, from when its worker starts it, loaded

/** What a search found, or why it found nothing. */
export type Found = { matches: Match[]; more: boolean } | { error: string };

// A worker done with its search, kept for the next one; one busy is ended to stop its search.
let idle: Worker | undefined;

/** Finds the pattern in the lines, then calls `done`; the function returned stops it. */
export function find(lines: readonly string[], pattern: Pattern, done: (found: Found) => void) {
  if (typeof Worker === "undefined") {
    const timer = setTimeout(() => done(findMatches(lines, pattern, LIMIT)));
    return () => clearTimeout(timer);
  }
  const worker = idle ?? new FindWorker();
  idle = undefined;
  let busy = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const end = () => {
    busy = false;
    clearTimeout(timer);
    worker.terminate();
  };
  worker.onmessage = ({ data }: MessageEvent<Found | "started">) => {
    if (data === "started") {
      timer = setTimeout(() => {
        end();
        done({ error: `Stopped after ${TIMEOUT / 1000} s: the expression takes too long` });
      }, TIMEOUT);
      return;
    }
    busy = false;
    clearTimeout(timer);
    if (idle === undefined) idle = worker;
    else worker.terminate();
    done(data);
  };
  worker.onerror = (event) => {
    event.preventDefault();
    end();
    done({ error: `Couldn't search: ${event.message || "its worker failed"}` });
  };
  worker.postMessage({ lines, pattern, limit: LIMIT });
  return () => {
    if (busy) end();
  };
}
