import type { ComponentType } from "react";
import type { Address } from "./address";
import { DaemonView } from "./daemon/DaemonView";
import { EventsView } from "./events/EventsView";

/** What a View gets: its parameters, and a way to show others instead, e.g. when filtered. */
export interface ViewProps {
  params: Address["params"];
  setParams: (params: Address["params"]) => void;
}

/** A kind of View: how to show it, and what its tab says. */
export interface ViewKind {
  name: string;
  title?: (params: Address["params"]) => string; // the tab's, if not just the name
  component: ComponentType<ViewProps>;
  suggested?: boolean; // offered in an empty Group
}

/** Every kind of View the GUI has. Views know nothing of Panels: `layout/` places them. */
export const VIEWS: Record<string, ViewKind> = {
  daemon: { name: "Daemon", component: DaemonView, suggested: true },
  events: { name: "Events", component: EventsView, suggested: true },
};

export function viewKind(kind: string): ViewKind | undefined {
  return Object.hasOwn(VIEWS, kind) ? VIEWS[kind] : undefined;
}

export function viewTitle({ kind, params }: Address): string {
  const found = viewKind(kind);
  return found === undefined ? kind : (found.title?.(params) ?? found.name);
}
