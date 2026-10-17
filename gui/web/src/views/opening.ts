import { createContext, useCallback, useContext } from "react";
import { type Address, addressText } from "./address";

/** Where a View opens: beside the one opening it, and as a preview, which the next replaces. */
export interface Opening {
  beside?: boolean;
  preview?: boolean;
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

/** The addresses of the Views shown, each Group's visible Panel's; given by `layout/`. */
export const ShownContext = createContext<ReadonlySet<string>>(new Set());

/** Whether a View is shown, in any Group: e.g. to mark the row that opened it. */
export function useIsShown(): (address: Address) => boolean {
  const shown = useContext(ShownContext);
  return useCallback((address: Address) => shown.has(addressText(address)), [shown]);
}
