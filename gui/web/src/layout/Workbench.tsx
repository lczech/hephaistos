import "dockview-react/dist/styles/dockview.css";
import "./dock.css";
import { type DockviewApi, DockviewReact, type DockviewReadyEvent } from "dockview-react";
import { useEffect, useRef } from "react";
import { defaultLayout, PANEL, THEME } from "./dock";
import { GroupActions } from "./GroupActions";
import { PanelView } from "./PanelView";
import { Placeholder } from "./Placeholder";
import { savedLayout, saveLayout } from "./saved";
import { useDockRegistry } from "./ViewOpener";
import { ViewTab } from "./ViewTab";

const SAVE_DELAY = 300; // ms: a drag or resize saves once, when it ends

/** Saves the Layout whenever it changes, until disposed. */
function keepSaved(api: DockviewApi): { dispose: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const changes = api.onDidLayoutChange(() => {
    clearTimeout(timer);
    timer = setTimeout(() => saveLayout(api.toJSON()), SAVE_DELAY);
  });
  return {
    dispose: () => {
      clearTimeout(timer);
      changes.dispose();
    },
  };
}

/** Ctrl+W closes the active Panel; only the Desktop passes it on, as browsers close their tab. */
function closeByKey(api: DockviewApi): { dispose: () => void } {
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "w" || !event.ctrlKey || event.altKey || event.metaKey) return;
    event.preventDefault();
    api.activePanel?.api.close();
  };
  window.addEventListener("keydown", onKey);
  return { dispose: () => window.removeEventListener("keydown", onKey) };
}

function restore(api: DockviewApi): void {
  const saved = savedLayout();
  try {
    if (saved === null) defaultLayout(api);
    else api.fromJSON(saved);
  } catch {
    defaultLayout(api); // saved by a version that differs too much
  }
}

/** The Groups and Panels: the saved Layout, or the default one. */
export function Workbench() {
  const attached = useRef<{ dispose: () => void }[]>([]);
  const register = useDockRegistry();
  useEffect(
    () => () => {
      for (const part of attached.current) part.dispose();
      register(null);
    },
    [register],
  );
  const ready = ({ api }: DockviewReadyEvent) => {
    for (const part of attached.current) part.dispose();
    attached.current = [keepSaved(api), closeByKey(api)];
    restore(api);
    register(api);
  };
  return (
    <DockviewReact
      components={{ [PANEL]: PanelView }}
      defaultTabComponent={ViewTab}
      rightHeaderActionsComponent={GroupActions}
      watermarkComponent={Placeholder}
      noPanelsOverlay="emptyGroup"
      theme={THEME}
      onReady={ready}
    />
  );
}
