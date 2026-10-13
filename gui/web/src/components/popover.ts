/**
 * Puts a popover below the button that opens it, at its left or right edge. Popovers open in
 * the top layer, so nothing clips them, but they don't know where their button is.
 */
export function placeBelow(
  popover: HTMLElement | null,
  button: HTMLElement,
  edge: "left" | "right",
): void {
  if (popover === null) return;
  const { left, right, bottom } = button.getBoundingClientRect();
  popover.style.setProperty("top", `${bottom}px`);
  popover.style.setProperty(
    edge,
    `${edge === "left" ? left : document.documentElement.clientWidth - right}px`,
  );
}
