// Where the window was, so that it opens there again; kept in the Desktop's profile.

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The window's size, its place if the desktop lets windows know it, and whether maximised. */
export interface Bounds {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized: boolean;
}

export const FIRST: Bounds = { width: 1280, height: 800, maximized: false };
const SMALLEST = 400;

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** The saved bounds, if they are sound; else those of a first start. */
export function savedBounds(text: string | null): Bounds {
  let saved: Record<string, unknown>;
  try {
    saved = JSON.parse(text ?? "null") ?? {};
  } catch {
    return FIRST;
  }
  const { width, height, x, y, maximized } = saved;
  if (!isNumber(width) || !isNumber(height) || width < SMALLEST || height < SMALLEST) return FIRST;
  const place = isNumber(x) && isNumber(y) ? { x, y } : {};
  return { width, height, ...place, maximized: maximized === true };
}

/** The bounds without their place unless it overlaps a screen, e.g. one unplugged since. */
export function onScreen(bounds: Bounds, screens: Rectangle[]): Bounds {
  const { x, y, ...size } = bounds;
  if (x === undefined || y === undefined) return bounds;
  const overlaps = (area: Rectangle) =>
    x < area.x + area.width &&
    x + bounds.width > area.x &&
    y < area.y + area.height &&
    y + bounds.height > area.y;
  return screens.some(overlaps) ? bounds : size;
}
