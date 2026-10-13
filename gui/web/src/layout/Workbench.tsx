import "dockview-react/dist/styles/dockview.css";
import "./dock.css";
import { type DockviewApi, DockviewReact, type DockviewReadyEvent } from "dockview-react";
import { useEffect, useRef } from "react";
import { defaultLayout, PANEL, THEME } from "./dock";
import { GroupActions } from "./GroupActions";
import { PanelView } from "./PanelView";
import { Placeholder } from "./Placeholder";
import { savedLayout, saveLayout } from "./saved";

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
  const saving = useRef<{ dispose: () => void } | null>(null);
  useEffect(() => () => saving.current?.dispose(), []);
  const ready = ({ api }: DockviewReadyEvent) => {
    saving.current?.dispose();
    saving.current = keepSaved(api);
    restore(api);
  };
  return (
    <DockviewReact
      components={{ [PANEL]: PanelView }}
      rightHeaderActionsComponent={GroupActions}
      watermarkComponent={Placeholder}
      noPanelsOverlay="emptyGroup"
      theme={THEME}
      onReady={ready}
    />
  );
}
