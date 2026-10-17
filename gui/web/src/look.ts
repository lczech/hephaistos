// The settings [gui.text] and [gui.code] as the custom properties of `theme.css`, which hold
// their defaults until the settings are known.

import { useEffect } from "react";
import { useConfig } from "./api/queries";

const pixels = (value: unknown) => (typeof value === "number" ? `${value}px` : undefined);
const text = (value: unknown) => (typeof value === "string" ? value : undefined);

const PROPERTIES: [key: string, property: string, as: (value: unknown) => string | undefined][] = [
  ["gui.text.size", "--text-size", pixels],
  ["gui.text.font", "--font", text],
  ["gui.code.size", "--code-size", pixels],
  ["gui.code.font", "--font-mono", text],
];

/** Applies the fonts and sizes the settings name to the whole page. */
export function useLook(): void {
  const settings = useConfig().data?.settings;
  useEffect(() => {
    const style = document.documentElement.style;
    for (const [key, property, as] of PROPERTIES) {
      const value = as(settings?.find((setting) => setting.key === key)?.applied);
      if (value !== undefined) style.setProperty(property, value);
    }
    return () => {
      for (const [, property] of PROPERTIES) style.removeProperty(property);
    };
  }, [settings]);
}
