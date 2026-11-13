// Marking for a moment where a click led, e.g. a tab already open, or a row gone to.

// The accent, held a moment, then fading to the colours of the element itself.
const MARKED = {
  color: "var(--accent)",
  backgroundColor: "color-mix(in srgb, var(--accent) 15%, transparent)",
};
const FLASH: Keyframe[] = [
  { offset: 0, ...MARKED },
  { offset: 0.4, ...MARKED },
];

/** Marks an element for a moment, to show where a click led. */
export function flash(element: Element | null | undefined): void {
  element?.animate(FLASH, { duration: 900, easing: "ease-out" });
}
