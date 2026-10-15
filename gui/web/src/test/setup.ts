import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { forgetToken } from "../token";
import { FakeSocket } from "./live";

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

// Live connections stay connecting, unless a test opens them.
beforeEach(() => {
  FakeSocket.opened = [];
  vi.stubGlobal("WebSocket", FakeSocket);
});

afterEach(() => {
  cleanup();
  forgetToken();
  localStorage.clear();
  vi.unstubAllGlobals();
});
