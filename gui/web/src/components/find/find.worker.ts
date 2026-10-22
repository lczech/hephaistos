// Finds a pattern's matches in lines, off the page: a regular expression that takes too long can
// be stopped, with its worker (`matcher.ts`).
import { findMatches } from "./pattern";

addEventListener("message", ({ data }: MessageEvent) => {
  postMessage("started"); // the time it may take starts now, the worker loaded
  postMessage(findMatches(data.lines, data.pattern, data.limit));
});
