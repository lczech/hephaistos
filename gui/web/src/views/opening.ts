import { createContext, useContext } from "react";
import type { Address } from "./address";

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
