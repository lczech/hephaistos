import {
  type DockviewApi,
  type DockviewTheme,
  type IDockviewPanel,
  themeLight,
} from "dockview-react";
import { viewTitle } from "../views";
import { type Address, addressText, asAddress } from "../views/address";

export const PANEL = "view"; // dockview's one component: every Panel shows the View its parameters name

/** dockview's light theme for sizes and behaviour; `dock.css` gives it our colours. */
export const THEME: DockviewTheme = {
  ...themeLight,
  name: "hephaistos",
  className: `${themeLight.className} hephaistos-dock`,
};

const DAEMON: Address = { kind: "daemon", params: {} };
const EVENTS: Address = { kind: "events", params: {} };

type Position = Parameters<DockviewApi["addPanel"]>[0]["position"];

/** Shows a View: focuses a Panel showing it, or opens one (by default in the active Group). */
export function openView(api: DockviewApi, address: Address, position?: Position): IDockviewPanel {
  const text = addressText(address);
  const open = api.panels.find((panel) => {
    const shown = asAddress(panel.params);
    return shown !== null && addressText(shown) === text;
  });
  if (open !== undefined) {
    open.api.setActive();
    return open;
  }
  const { kind, params } = address;
  return api.addPanel({
    id: crypto.randomUUID(), // a Panel's View can change, so its ID doesn't name it
    component: PANEL,
    title: viewTitle(address),
    params: { kind, params },
    position,
  });
}

/** The Layout a new GUI starts with, and falls back to. */
export function defaultLayout(api: DockviewApi): void {
  api.clear();
  const daemon = openView(api, DAEMON);
  openView(api, EVENTS, { referencePanel: daemon, direction: "right" });
}
