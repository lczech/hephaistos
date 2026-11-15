import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QUERY_DEFAULTS } from "./api/queries";
import { json, serve } from "./test/server";
import { schemeOf, showScheme, useColorScheme } from "./theme";

afterEach(() => vi.unstubAllGlobals());

describe("light or dark", () => {
  it("is as gui.theme chooses, else as the system is, also while the setting is unknown", () => {
    expect(schemeOf("light", "dark")).toBe("light");
    expect(schemeOf("dark", "light")).toBe("dark");
    expect(schemeOf("system", "dark")).toBe("dark");
    expect(schemeOf(undefined, "light")).toBe("light");
  });

  it("is said on the page's root, for the stylesheets", () => {
    showScheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    showScheme(); // the system's: jsdom says none, so light
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("says the bars' colour as the page's theme colour, for the window's buttons", () => {
    const root = document.documentElement;
    root.style.setProperty("--bar", "#181818");
    showScheme("dark");
    root.style.setProperty("--bar", "#f8f8f8");
    showScheme("light");
    const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
    expect([...metas].map((meta) => meta.content)).toEqual(["#f8f8f8"]);
    root.style.removeProperty("--bar");
  });
});

describe("the system's light or dark", () => {
  it("is followed as it changes", () => {
    const listeners = new Set<() => void>();
    const query = {
      matches: false,
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    };
    vi.stubGlobal("matchMedia", () => query);
    serve({ "GET /api/config": () => json({ settings: [] }) });
    const client = new QueryClient(QUERY_DEFAULTS);
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);
    const { result } = renderHook(() => useColorScheme(), { wrapper });
    expect(result.current).toBe("light");
    act(() => {
      query.matches = true;
      for (const listener of listeners) listener();
    });
    expect(result.current).toBe("dark");
  });
});
