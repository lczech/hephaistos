import type { DockviewApi } from "dockview-react";
import { createContext, type ReactNode, useCallback, useContext, useState } from "react";
import type { Address } from "../views/address";
import { type Opening, OpenViewContext } from "../views/opening";
import { openView } from "./dock";

const DockRegistry = createContext<(api: DockviewApi | null) => void>(() => {});

/**
 * Lets everything within open Views, e.g. the status bar: in (or beside) the active Group of the
 * Workbench within it. A Panel's View opens them from its own Group instead, by its own provider.
 */
export function ViewOpener({ children }: { children: ReactNode }) {
  const [dock, setDock] = useState<DockviewApi | null>(null);
  const open = useCallback(
    (address: Address, opening?: Opening) => {
      if (dock !== null) openView(dock, address, opening);
    },
    [dock],
  );
  return (
    <DockRegistry value={setDock}>
      <OpenViewContext value={open}>{children}</OpenViewContext>
    </DockRegistry>
  );
}

/** How the Workbench tells the ViewOpener around it which dockview to open Views in. */
export function useDockRegistry(): (api: DockviewApi | null) => void {
  return useContext(DockRegistry);
}
