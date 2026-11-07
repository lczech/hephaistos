// The window's title bar: the GUI draws it, Chromium the window's buttons over its right end
// (the Window Controls Overlay), in the colour the GUI says as its theme colour.

/** px, the window's buttons'; the GUI's bar takes it from them, with its border below them. */
export const TITLE_BAR_HEIGHT = 31;

// theme.css's `--bar`, until the page says its own
const BAR = { light: "#f8f8f8", dark: "#181818" };
// theme.css's `--text`, light and dark: the buttons' symbols against a dark or light bar
const SYMBOL = { onDark: "#cccccc", onLight: "#3b3b3b" };

/** The window's buttons in the page's theme colour, else the system's bar colour, their
 * symbols light on a dark one and dark on a light one. */
export function buttonColours(
  colour: string | null,
  systemDark: boolean,
): { color: string; symbolColor: string } {
  const color =
    colour && /^#[0-9a-f]{6}$/i.test(colour) ? colour : systemDark ? BAR.dark : BAR.light;
  const channel = (at: number) => Number.parseInt(color.slice(at, at + 2), 16);
  const dark = 0.299 * channel(1) + 0.587 * channel(3) + 0.114 * channel(5) < 128;
  return { color, symbolColor: dark ? SYMBOL.onDark : SYMBOL.onLight };
}
