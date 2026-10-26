// Whether the GUI is light or dark, decided in one place: the setting `gui.theme`, `system`
// following the system's as it changes. The page says it as `data-theme` on its root, which
// theme.css's colours and the browser's own controls follow; diffs ask `useColorScheme`.

import { useEffect, useSyncExternalStore } from "react";
import { useSetting } from "./api/queries";

export type ColorScheme = "light" | "dark";

const DARK = "(prefers-color-scheme: dark)";

/** The system's scheme now: light where it can't say, e.g. in tests. */
export function systemScheme(): ColorScheme {
  return globalThis.matchMedia?.(DARK).matches ? "dark" : "light";
}

function onSystemChange(changed: () => void): () => void {
  const query = globalThis.matchMedia?.(DARK);
  query?.addEventListener("change", changed);
  return () => query?.removeEventListener("change", changed);
}

/** The scheme a `gui.theme` value chooses: its own, else the system's (`system`, or unknown yet). */
export function schemeOf(chosen: unknown, system: ColorScheme): ColorScheme {
  return chosen === "light" || chosen === "dark" ? chosen : system;
}

/** The scheme in effect, as the setting chooses it, the system's followed as it changes. */
export function useColorScheme(): ColorScheme {
  const system = useSyncExternalStore(onSystemChange, systemScheme);
  return schemeOf(useSetting("gui.theme"), system);
}

/** Says a scheme on the page's root, for theme.css; the system's before the first render. */
export function showScheme(scheme: ColorScheme = systemScheme()): void {
  document.documentElement.dataset.theme = scheme;
}

/** Keeps the page's scheme as `useColorScheme` has it. */
export function useTheme(): void {
  const scheme = useColorScheme();
  useEffect(() => showScheme(scheme), [scheme]);
}
