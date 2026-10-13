import { type DockviewApi, type DockviewTheme, themeLight } from "dockview-react";
import { viewTitle } from "../views";
import { type Address, panelId } from "../views/address";

export const PANEL = "view"; // dockview's one component: every Panel shows a View by its ID

/** dockview's light theme for sizes and behaviour; `dock.css` gives it our colours. */
export const THEME: DockviewTheme = {
  ...themeLight,
  name: "hephaistos",
  className: `${themeLight.className} hephaistos-dock`,
};

const DAEMON: Address = { kind: "daemon", params: {} };
const EVENTS: Address = { kind: "events", params: {} };

type Position = Parameters<DockviewApi["addPanel"]>[0]["position"];

/** Shows a View: focuses the Panel showing it, or opens one (by default in the active Group). */
export function openView(api: DockviewApi, address: Address, position?: Position): void {
  const id = panelId(address);
  const open = api.getPanel(id);
  if (open !== undefined) {
    open.api.setActive();
    return;
  }
  api.addPanel({ id, component: PANEL, title: viewTitle(address), position });
}

/** The Layout a new GUI starts with, and falls back to. */
export function defaultLayout(api: DockviewApi): void {
  api.clear();
  openView(api, DAEMON);
  openView(api, EVENTS, { referencePanel: panelId(DAEMON), direction: "right" });
}
