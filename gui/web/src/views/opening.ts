import { createContext, useContext } from "react";
import { type Address, viewKey } from "./address";

/** Where a View opens: beside the one opening it, and as a preview, which the next replaces. */
export interface Opening {
  beside?: boolean;
  preview?: boolean;
}

/**
 * How a click on a link opens its View: as a preview, in its Group, or beside it by the middle
 * button or Alt, as browsers open a link in place or in a new tab.
 */
export function clickOpening(event: { button: number; altKey: boolean }): Opening {
  return { beside: event.button === 1 || event.altKey, preview: true };
}

/**
 * Shows a View: focuses one showing that address, or opens it, by default in the current Group.
 * Opening it as not a preview keeps a preview that shows it.
 */
export type OpenView = (address: Address, opening?: Opening) => void;

/** Given by `layout/`, which places Views; nothing outside a Panel, e.g. in tests. */
export const OpenViewContext = createContext<OpenView>(() => {});

export function useOpenView(): OpenView {
  return useContext(OpenViewContext);
}

/** The Views shown, each Group's visible Panel's, by their keys (`viewKey`); given by `layout/`. */
export const ShownContext = createContext<ReadonlySet<string>>(new Set());

/** Whether a View is shown, in any Group, however it is looked at: e.g. to mark the row that opened it. */
export function useIsShown(): (address: Address) => boolean {
  const shown = useContext(ShownContext);
  return (address: Address) => shown.has(viewKey(address));
}
