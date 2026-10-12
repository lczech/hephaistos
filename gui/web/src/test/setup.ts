import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { forgetToken } from "../token";

afterEach(() => {
  cleanup();
  forgetToken();
  vi.unstubAllGlobals();
});
