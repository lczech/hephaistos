import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterAll, afterEach, beforeEach, expect, vi } from "vitest";
import { forgetKept } from "../kept";
import { forgetToken } from "../token";
import { beginFuzzing, endFuzzing, FUZZ_SEED, FUZZED_WAIT } from "./fuzz";
import { FakeSocket } from "./live";
import { noteUnanswered, takeUnanswered } from "./server";

// Stand-ins for what jsdom lacks; in a real browser, its own.

// jsdom measures nothing, so dockview's observer of sizes has nothing to report.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Nor does anything scroll into view; tests that need it stand in their own.
globalThis.IntersectionObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
} as unknown as typeof IntersectionObserver;

// Nor has a list a height, so it would draw none of its rows (`VirtualRows`): one tall enough
// for all a test shows, which measure nothing either.
const clientHeight = Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight");
if (navigator.userAgent.includes("jsdom")) {
  Object.defineProperty(Element.prototype, "clientHeight", {
    configurable: true,
    get(this: Element) {
      return this.matches("[data-layout]") ? 100_000 : (clientHeight?.get?.call(this) ?? 0);
    },
  });
}

// Nor does it animate.
Element.prototype.animate ??= () => ({}) as Animation;

// Nor has it `checkVisibility`, so React Aria asks for the computed style of each list item and
// of all above it instead, which jsdom works out slowly: hundreds of milliseconds to open a list.
// Tests load no style sheets: only `hidden` or an element's own style hides it.
Element.prototype.checkVisibility ??= function (this: Element, options?: CheckVisibilityOptions) {
  let visibility = "";
  for (let element: Element | null = this; element; element = element.parentElement) {
    const style = (element as HTMLElement).style as CSSStyleDeclaration | undefined;
    if (element.hasAttribute("hidden") || style?.display === "none") return false;
    visibility ||= style?.visibility ?? ""; // inherited: the nearest one set counts
  }
  return !(options?.visibilityProperty && ["hidden", "collapse"].includes(visibility));
};

// No test reaches a Server: requests fail unless a test answers them (`serve`), and live
// connections stay connecting unless it opens them. Set once rather than stubbed, so that what
// the GUI asks for after a test ended, e.g. a diff scrolled near, meets them too, not the
// browser's own. A request no test answered fails the test, or the next one once it ended,
// whose message names the test before.
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  noteUnanswered(input instanceof Request ? input.method : (init?.method ?? "GET"), url);
  throw new Error(`no server in tests: ${url}; answer it with serve()`);
};
globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;

// The test of this file that ended last, which a request coming late may be from.
let before: string | undefined;

const ended = (test: string) => `after the test "${test}" ended`;

/** Fails with the requests no test answered, saying when they came (`when`). */
function failUnanswered(when: string) {
  const counts = new Map<string, number>();
  for (const request of takeUnanswered()) counts.set(request, (counts.get(request) ?? 0) + 1);
  const named = [...counts].map(([request, n]) => (n > 1 ? `${request} (${n} times)` : request));
  if (named.length > 0) throw new Error(`requests no test answered ${when}: ${named.join(", ")}`);
}

// Fuzzed, answers come later, so finding what they bring waits longer.
if (FUZZ_SEED !== "") configure({ asyncUtilTimeout: FUZZED_WAIT });

beforeEach((context) => {
  FakeSocket.opened = [];
  beginFuzzing(expect.getState().currentTestName ?? context.task.name);
  if (FUZZ_SEED !== "") {
    context.onTestFailed(() => console.error(`fuzzed: replay with TEST_FUZZ_SEED=${FUZZ_SEED}`));
  }
  if (before !== undefined) failUnanswered(ended(before));
});

afterEach(() => {
  // First, so that a cleanup that throws still leaves the next test naming this one.
  const earlier = before;
  before = expect.getState().currentTestName;
  endFuzzing();
  cleanup();
  forgetToken();
  localStorage.clear();
  forgetKept();
  vi.unstubAllGlobals();
  failUnanswered(earlier === undefined ? "in this test" : `in this test, or ${ended(earlier)}`);
});

// What came after the last test of a file ended.
afterAll(() => {
  if (before !== undefined) failUnanswered(ended(before));
});
