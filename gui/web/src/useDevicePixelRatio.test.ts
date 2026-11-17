import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useDevicePixelRatio } from "./useDevicePixelRatio";

afterEach(() => vi.unstubAllGlobals());

it("follows the ratio of device pixels as it changes, e.g. with the zoom, each time", () => {
  const asked: string[] = [];
  const listeners = new Map<string, () => void>();
  vi.stubGlobal("matchMedia", (query: string) => {
    asked.push(query);
    return {
      addEventListener: (_: string, listener: () => void) => listeners.set(query, listener),
      removeEventListener: (_: string, listener: () => void) => {
        if (listeners.get(query) === listener) listeners.delete(query);
      },
    };
  });
  vi.stubGlobal("devicePixelRatio", 1);
  const { result, unmount } = renderHook(() => useDevicePixelRatio());
  expect(result.current).toBe(1);
  for (const ratio of [1.25, 2]) {
    const before = listeners.get(asked.at(-1) ?? "");
    vi.stubGlobal("devicePixelRatio", ratio);
    act(() => before?.());
    expect(result.current).toBe(ratio);
    expect(asked.at(-1)).toBe(`(resolution: ${ratio}dppx)`); // listening for the next change
  }
  unmount();
  expect(listeners.has("(resolution: 2dppx)")).toBe(false);
});
