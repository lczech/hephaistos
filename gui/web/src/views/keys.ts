import { createContext, type RefCallback, useContext } from "react";

/** What keys the Workbench takes go to in a View: Ctrl+F, to its search field. */
export type KeyTarget = "search";

/**
 * Notes an element of a View as where a key goes, until it is gone; given by `layout/`, which
 * keeps them per Panel. Nothing outside a Panel, e.g. in tests.
 */
export type NoteKeyTarget = (target: KeyTarget, element: HTMLElement | null) => void;

export const KeyTargetContext = createContext<NoteKeyTarget>(() => {});

/** A ref making its element where the key goes in this View; none for `undefined`. */
export function useKeyTarget(target: KeyTarget | undefined): RefCallback<HTMLElement> {
  const note = useContext(KeyTargetContext);
  return (element) => {
    if (target === undefined || element === null) return;
    note(target, element);
    return () => note(target, null);
  };
}
