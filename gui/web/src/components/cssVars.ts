import type { CSSProperties } from "react";

/** Values reaching CSS from what the page knows only at runtime: custom properties by name. */
export type CssVars = Record<`--${string}`, string | number>;

/**
 * An inline style of custom properties only: the look stays in the stylesheets, which use them
 * (a lint rule, `gui/lint/inline-styles.grit`, takes no other inline style).
 */
export function cssVars(vars: CssVars): CSSProperties {
  return vars as CSSProperties;
}
