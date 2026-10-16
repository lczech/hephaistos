/** Where a Group is, relative to the Workbench, in pixels. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const TOUCH = 2; // px: edges this close touch, whatever the sashes between them take

type Side = "right" | "below" | "left" | "above";
const ORDER: Side[] = ["right", "below", "left", "above"];

/** How far two spans overlap. */
function overlap(start: number, length: number, otherStart: number, otherLength: number): number {
  return Math.min(start + length, otherStart + otherLength) - Math.max(start, otherStart);
}

function touches(from: Box, other: Box, side: Side): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) <= TOUCH;
  switch (side) {
    case "right":
      return (
        near(other.left, from.left + from.width) &&
        overlap(from.top, from.height, other.top, other.height) > TOUCH
      );
    case "left":
      return (
        near(other.left + other.width, from.left) &&
        overlap(from.top, from.height, other.top, other.height) > TOUCH
      );
    case "below":
      return (
        near(other.top, from.top + from.height) &&
        overlap(from.left, from.width, other.left, other.width) > TOUCH
      );
    case "above":
      return (
        near(other.top + other.height, from.top) &&
        overlap(from.left, from.width, other.left, other.width) > TOUCH
      );
  }
}

/**
 * The Group beside `from`: the first side, of right, below, left and above, that another Group
 * touches; of several there, the topmost (right, left) or leftmost (below, above).
 */
export function besideOf<T>(from: Box, others: { item: T; box: Box }[]): T | undefined {
  for (const side of ORDER) {
    const touching = others.filter(({ box }) => touches(from, box, side));
    const across = side === "right" || side === "left" ? "top" : "left";
    touching.sort((a, b) => a.box[across] - b.box[across]);
    if (touching[0]) return touching[0].item;
  }
  return undefined;
}
