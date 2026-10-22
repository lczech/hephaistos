import type { DockviewApi, IDockviewGroupPanel } from "dockview-react";
import { createContext, type MouseEvent, type RefObject, useContext } from "react";
import { type Address, addressText, asAddress } from "../views/address";
import { noteTyped, openView, showIn, typingRun } from "./dock";

/** A View a Group showed: its Panel, its address as last seen, and the run of keys typed into it. */
interface Visit {
  panel: string;
  address: Address;
  typed: number | undefined;
}

/** A Group's Views before and after the one it shows, as a browser tab's pages. */
interface Trail {
  past: Visit[];
  now: Visit | undefined;
  future: Visit[];
}

const KEPT = 50; // Views back per Group

const BACK = 3; // MouseEvent.button of the side buttons
const FORWARD = 4;

function visitOf(group: IDockviewGroupPanel): Visit | undefined {
  const panel = group.activePanel;
  const address = asAddress(panel?.params);
  return panel && address ? { panel: panel.id, address, typed: typingRun(panel) } : undefined;
}

const same = (a: Visit | undefined, b: Visit | undefined) =>
  a?.panel === b?.panel && (a && addressText(a.address)) === (b && addressText(b.address));

/** Going back or forward in a Group, as the mouse's side buttons over it do. */
export interface Visits {
  go: (group: IDockviewGroupPanel, back: boolean) => void;
  dispose: () => void;
}

/** The Workbench's `Visits`, once its Views are restored; for the parts of its Groups. */
export const VisitsContext = createContext<RefObject<Visits | null> | null>(null);

/**
 * The mouse's side buttons over a part of a Group, its tabs, its View, or its placeholder: back
 * and forward there. The Group is the part's own, as dockview gives it, not found by where its
 * elements are: dockview draws Views over their Groups, not in them.
 */
export function useSideButtons(group: IDockviewGroupPanel | undefined) {
  const visits = useContext(VisitsContext);
  return (event: MouseEvent) => {
    if (group === undefined || (event.button !== BACK && event.button !== FORWARD)) return;
    visits?.current?.go(group, event.button === BACK);
  };
}

/**
 * Back and forward through the Views each Group showed, as in a browser tab: by the mouse's side
 * buttons, in the Group under the pointer (`useSideButtons`), or Alt+←/→, in the active one. Each address a Group
 * shows is a step: another Panel's, or another one in the same Panel (a link replacing a preview,
 * a filter, another Revision compared), but for keys typed in a row, e.g. a search, which are one.
 * Going back shows a Panel's View again, in that Panel, or as a preview where the Panel is gone.
 * Kept until the page is left.
 */
export function keepVisits(api: DockviewApi): Visits {
  const trails = new Map<string, Trail>();
  let moving = false;

  const trailOf = (group: IDockviewGroupPanel): Trail => {
    let trail = trails.get(group.id);
    if (trail === undefined) {
      trail = { past: [], now: visitOf(group), future: [] };
      trails.set(group.id, trail);
    }
    return trail;
  };

  // Notes each Group's View: another one is a step, but for another key typed into it.
  const note = () => {
    for (const group of api.groups) {
      const trail = trailOf(group);
      const visit = visitOf(group);
      const { now } = trail;
      if (visit === undefined || same(visit, now)) continue;
      const typing =
        now?.panel === visit.panel && now.typed !== undefined && now.typed === visit.typed;
      if (!moving && now !== undefined && !typing) {
        trail.past = [...trail.past, now].slice(-KEPT);
        trail.future = [];
      }
      trail.now = visit;
    }
    const groups = new Set(api.groups.map((group) => group.id));
    for (const id of trails.keys()) if (!groups.has(id)) trails.delete(id);
  };

  /** Shows the View before (or after) the one shown, which goes after (or before) it. */
  const go = (group: IDockviewGroupPanel, back: boolean) => {
    note(); // the View shown as it is now, e.g. filtered
    const trail = trailOf(group);
    const [from, to] = back ? [trail.past, trail.future] : [trail.future, trail.past];
    const target = from.pop();
    if (target === undefined) return;
    const was = trail.now;
    if (was) to.push(was);
    moving = true;
    try {
      const text = addressText(target.address);
      const showing = (panel: { params?: Record<string, unknown> }) => {
        const address = asAddress(panel.params);
        return address !== null && addressText(address) === text;
      };
      const panel =
        group.panels.find((panel) => panel.id === target.panel) ?? group.panels.find(showing);
      if (panel) {
        if (!showing(panel)) showIn(panel, target.address);
        noteTyped(panel, false); // typing again is another step
        panel.api.setActive();
      } else openView(api, target.address, { preview: true }, group);
    } finally {
      moving = false;
    }
    trail.now = visitOf(group);
    if (was && same(trail.now, was)) to.pop(); // shown in another Group instead
  };

  // The side buttons anywhere: the browser's own back and forward would leave the page.
  const onMouse = (event: globalThis.MouseEvent) => {
    if (event.button === BACK || event.button === FORWARD) event.preventDefault();
  };
  const onKey = (event: KeyboardEvent) => {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const group = api.activeGroup;
    if (!group) return;
    event.preventDefault();
    go(group, event.key === "ArrowLeft");
  };

  note();
  const changes = [api.onDidLayoutChange(note), api.onDidActivePanelChange(note)];
  window.addEventListener("mousedown", onMouse);
  window.addEventListener("mouseup", onMouse);
  window.addEventListener("keydown", onKey);
  return {
    go,
    dispose: () => {
      for (const change of changes) change.dispose();
      window.removeEventListener("mousedown", onMouse);
      window.removeEventListener("mouseup", onMouse);
      window.removeEventListener("keydown", onKey);
    },
  };
}
