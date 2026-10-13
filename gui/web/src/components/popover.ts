/**
 * Puts a popover below an element, e.g. the button that opens it, at its left or right edge.
 * Popovers open in the top layer, so nothing clips them, but they don't know where that is.
 */
export function placeBelow(
  popover: HTMLElement | null,
  below: HTMLElement | null,
  edge: "left" | "right",
): void {
  if (popover === null || below === null) return;
  const { left, right, bottom } = below.getBoundingClientRect();
  popover.style.setProperty("top", `${bottom}px`);
  popover.style.setProperty(
    edge,
    `${edge === "left" ? left : document.documentElement.clientWidth - right}px`,
  );
}
