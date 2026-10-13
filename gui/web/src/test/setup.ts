import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { forgetToken } from "../token";

// jsdom measures nothing, so dockview's observer of sizes has nothing to report.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

afterEach(() => {
  cleanup();
  forgetToken();
  localStorage.clear();
  vi.unstubAllGlobals();
});
