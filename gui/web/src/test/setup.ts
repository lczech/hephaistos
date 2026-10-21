import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { forgetKept } from "../kept";
import { forgetToken } from "../token";
import { FakeSocket } from "./live";

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

// Live connections stay connecting, unless a test opens them.
beforeEach(() => {
  FakeSocket.opened = [];
  vi.stubGlobal("WebSocket", FakeSocket);
});

afterEach(() => {
  cleanup();
  forgetToken();
  localStorage.clear();
  forgetKept();
  vi.unstubAllGlobals();
});
