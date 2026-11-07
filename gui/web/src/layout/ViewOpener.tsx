import type { DockviewApi } from "dockview-react";
import { createContext, type ReactNode, useContext, useState } from "react";
import type { Address } from "../views/address";
import { type Opening, OpenViewContext } from "../views/opening";
import { openView } from "./dock";

const DockRegistry = createContext<(api: DockviewApi | null) => void>(() => {});
const Dock = createContext<DockviewApi | null>(null);

/**
 * Lets everything within open Views, e.g. the status bar: in (or beside) the active Group of the
 * Workbench within it. A Panel's View opens them from its own Group instead, by its own provider.
 */
export function ViewOpener({ children }: { children: ReactNode }) {
  const [dock, setDock] = useState<DockviewApi | null>(null);
  const open = (address: Address, opening?: Opening) => {
    if (dock !== null) openView(dock, address, opening);
  };
  return (
    <DockRegistry value={setDock}>
      <Dock value={dock}>
        <OpenViewContext value={open}>{children}</OpenViewContext>
      </Dock>
    </DockRegistry>
  );
}

/** How the Workbench tells the ViewOpener around it which dockview to open Views in. */
export function useDockRegistry(): (api: DockviewApi | null) => void {
  return useContext(DockRegistry);
}

/** The Workbench's dockview, for what acts on its Groups from outside it, e.g. the title bar. */
export function useDock(): DockviewApi | null {
  return useContext(Dock);
}
