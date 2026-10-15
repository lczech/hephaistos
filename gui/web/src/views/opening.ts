import { createContext, useContext } from "react";
import type { Address } from "./address";

/** Shows a View: focuses one showing that address, or opens it beside the current one. */
export type OpenView = (address: Address) => void;

/** Given by `layout/`, which places Views; nothing outside a Panel, e.g. in tests. */
export const OpenViewContext = createContext<OpenView>(() => {});

export function useOpenView(): OpenView {
  return useContext(OpenViewContext);
}
