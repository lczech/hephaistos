import "dockview-react/dist/styles/dockview.css";
import "./dock.css";
import { type DockviewApi, DockviewReact, type DockviewReadyEvent } from "dockview-react";
import { useEffect, useRef, useState } from "react";
import { addressText, asAddress } from "../views/address";
import { ShownContext } from "../views/opening";
import { defaultLayout, keep, PANEL, THEME } from "./dock";
import { GroupActions } from "./GroupActions";
import { PanelView } from "./PanelView";
import { Placeholder } from "./Placeholder";
import { savedLayout, saveLayout } from "./saved";
import { useDockRegistry } from "./ViewOpener";
import { ViewTab } from "./ViewTab";
import { keepVisits } from "./visits";

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

/**
 * Ctrl+W closes the active Panel, or the active Group once empty, unless it is the last; only
 * the Desktop passes it on, as browsers close their tab.
 */
function closeByKey(api: DockviewApi): { dispose: () => void } {
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "w" || !event.ctrlKey || event.altKey || event.metaKey) return;
    event.preventDefault();
    const group = api.activeGroup;
    if (api.activePanel) api.activePanel.api.close();
    else if (group && group.panels.length === 0 && api.groups.length > 1) group.api.close();
  };
  window.addEventListener("keydown", onKey);
  return { dispose: () => window.removeEventListener("keydown", onKey) };
}

/**
 * Ctrl+F goes to the active Panel's search field, its text selected to type over; without one,
 * the browser finds in the page as usual.
 */
function searchByKey(api: DockviewApi): { dispose: () => void } {
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "f" || !event.ctrlKey || event.altKey || event.metaKey || event.shiftKey)
      return;
    // The active Group holds only its visible Panel's View.
    const field = api.activeGroup?.element.querySelector<HTMLInputElement>("input[type=search]");
    if (!field) return;
    event.preventDefault();
    field.focus();
    field.select();
  };
  window.addEventListener("keydown", onKey);
  return { dispose: () => window.removeEventListener("keydown", onKey) };
}

/** A preview dragged to another Group is kept there. */
function keepMoved(api: DockviewApi): { dispose: () => void } {
  return api.onDidMovePanel(({ panel, from, to }) => {
    if (from !== to) keep(panel);
  });
}

/** The addresses of the Views shown: each Group's visible Panel's. */
function shownAddresses(api: DockviewApi): ReadonlySet<string> {
  return new Set(
    api.groups.flatMap((group) => {
      const address = asAddress(group.activePanel?.params);
      return address ? [addressText(address)] : [];
    }),
  );
}

/** Keeps `set` given the Views shown, as Panels and Groups change. */
function keepShown(
  api: DockviewApi,
  set: (update: (shown: ReadonlySet<string>) => ReadonlySet<string>) => void,
): { dispose: () => void } {
  const update = () =>
    set((shown) => {
      const now = shownAddresses(api);
      const same = now.size === shown.size && [...now].every((address) => shown.has(address));
      return same ? shown : now;
    });
  update();
  const changes = [api.onDidLayoutChange(update), api.onDidActivePanelChange(update)];
  return {
    dispose: () => {
      for (const change of changes) change.dispose();
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

/** The Groups and Panels: the saved Layout, or the default one; telling Views which are shown. */
export function Workbench() {
  const attached = useRef<{ dispose: () => void }[]>([]);
  const [shown, setShown] = useState<ReadonlySet<string>>(new Set());
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
    attached.current = [
      keepSaved(api),
      closeByKey(api),
      searchByKey(api),
      keepMoved(api),
      keepShown(api, setShown),
    ];
    restore(api);
    attached.current.push(keepVisits(api)); // from the Views restored
    register(api);
  };
  return (
    <ShownContext value={shown}>
      <DockviewReact
        components={{ [PANEL]: PanelView }}
        defaultTabComponent={ViewTab}
        rightHeaderActionsComponent={GroupActions}
        watermarkComponent={Placeholder}
        noPanelsOverlay="emptyGroup"
        closeEmptyGroups={false}
        theme={THEME}
        onReady={ready}
      />
    </ShownContext>
  );
}
