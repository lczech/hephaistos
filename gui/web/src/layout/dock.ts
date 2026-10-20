import {
  type DockviewApi,
  type DockviewGroupPanel,
  type DockviewTheme,
  type IDockviewGroupPanel,
  type IDockviewPanel,
  themeLight,
} from "dockview-react";
import { type Address, addressText, asAddress } from "../views/address";
import { viewTitle } from "../views/kinds";
import type { Opening } from "../views/opening";
import { besideOf } from "./beside";

export const PANEL = "view"; // dockview's one component: every Panel shows the View its parameters name
export const PREVIEW = "preview"; // a Panel parameter, beside its View's: true while a preview

/** dockview's light theme for sizes and behaviour; `dock.css` gives it our colours. */
export const THEME: DockviewTheme = {
  ...themeLight,
  name: "hephaistos",
  className: `${themeLight.className} hephaistos-dock`,
};

const REPOSITORIES: Address = { kind: "repositories", params: {} };
const EVENTS: Address = { kind: "events", params: {} };

/** Whether a Panel with these parameters shows a preview. */
export function isPreview(params: Record<string, unknown> | undefined): boolean {
  return params?.[PREVIEW] === true;
}

/** Makes a preview Panel an ordinary one, which the next preview no longer replaces. */
export function keep(panel: IDockviewPanel | undefined): void {
  if (isPreview(panel?.params)) panel?.api.updateParameters({ [PREVIEW]: undefined });
}

// The accent, held a moment, then fading to the tab's own colours.
const MARKED = {
  color: "var(--accent)",
  backgroundColor: "color-mix(in srgb, var(--accent) 15%, transparent)",
};
const FLASH: Keyframe[] = [
  { offset: 0, ...MARKED },
  { offset: 0.4, ...MARKED },
];

/** Marks a Panel's tab for a moment, to show where a View already open is. */
function flash(panel: IDockviewPanel): void {
  const tab = panel.view.tab.element;
  (tab.closest(".dv-tab") ?? tab).animate(FLASH, { duration: 900, easing: "ease-out" });
}

/** The Group beside `from`, if it isn't alone; see `besideOf`. */
function besideGroup(api: DockviewApi, from: IDockviewGroupPanel): DockviewGroupPanel | undefined {
  const others = api.groups.filter(
    (group) => group.id !== from.id && group.api.location.type === "grid",
  );
  const box = api.groups.find((group) => group.id === from.id)?.api.boundingBox;
  const boxes = others.flatMap((group) => {
    const other = group.api.boundingBox;
    return other ? [{ item: group, box: other }] : [];
  });
  return (box && besideOf(box, boxes)) ?? others[0]; // the first before the Groups have sizes
}

/**
 * Shows a View: focuses a Panel showing it, flashing its tab, or opens one in `from`'s Group (by
 * default the active one), or beside it. A preview replaces the View of that Group's preview
 * Panel, if any.
 */
export function openView(
  api: DockviewApi,
  address: Address,
  opening: Opening = {},
  from: IDockviewGroupPanel | undefined = api.activeGroup,
): IDockviewPanel {
  const text = addressText(address);
  const open = api.panels.find((panel) => {
    const shown = asAddress(panel.params);
    return shown !== null && addressText(shown) === text;
  });
  if (open !== undefined) {
    if (!opening.preview) keep(open);
    open.api.setActive();
    flash(open);
    return open;
  }
  const { kind, params } = address;
  const title = viewTitle(address);
  const group = from && opening.beside ? besideGroup(api, from) : from;
  const replaced = opening.preview
    ? group?.panels.find((panel) => isPreview(panel.params))
    : undefined;
  if (replaced !== undefined) {
    replaced.api.updateParameters({ kind, params });
    replaced.api.setTitle(title);
    replaced.api.setActive();
    return replaced;
  }
  return api.addPanel({
    id: crypto.randomUUID(), // a Panel's View can change, so its ID doesn't name it
    component: PANEL,
    title,
    params: { kind, params, ...(opening.preview && { [PREVIEW]: true }) },
    position:
      group !== undefined
        ? { referenceGroup: group.id }
        : from && { referenceGroup: from.id, direction: "right" }, // beside, from a Group alone
  });
}

/** The Layout a new GUI starts with, and falls back to. */
export function defaultLayout(api: DockviewApi): void {
  api.clear();
  const repositories = openView(api, REPOSITORIES);
  openView(api, EVENTS, { beside: true }, repositories.group);
}
