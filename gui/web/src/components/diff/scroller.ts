// Where diffs scroll, for what lies within (`DiffScroll`); apart from `Diff`, which would load
// the renderer.
import { createContext, useContext } from "react";

/** The element diffs scroll in, once there; none outside a `DiffScroll`. */
export const DiffScrollerContext = createContext<() => HTMLElement | undefined>(() => undefined);

export function useDiffScroller(): () => HTMLElement | undefined {
  return useContext(DiffScrollerContext);
}
