import type { ComponentType } from "react";
import type { Address, Params } from "./address";
import { ConfigView } from "./config/ConfigView";
import { DaemonView } from "./daemon/DaemonView";
import { EventsView } from "./events/EventsView";
import { LogView } from "./log/LogView";

/** What a View gets: its parameters, and ways to change them and what its tab says. */
export interface ViewProps {
  params: Params;
  setParams: (params: Params) => void; // shows others instead, e.g. when filtered
  setTitle: (title: string) => void; // if not just the kind's name
}

/** A kind of View: what it is called, and how to show it. */
export interface ViewKind {
  name: string;
  component: ComponentType<ViewProps>;
  suggested?: boolean; // offered in an empty Group
}

/** Every kind of View the GUI has. Views know nothing of Panels: `layout/` places them. */
export const VIEWS: Record<string, ViewKind> = {
  daemon: { name: "Daemon", component: DaemonView, suggested: true },
  events: { name: "Events", component: EventsView, suggested: true },
  log: { name: "Log", component: LogView, suggested: true },
  config: { name: "Config", component: ConfigView },
};

export function viewKind(kind: string): ViewKind | undefined {
  return Object.hasOwn(VIEWS, kind) ? VIEWS[kind] : undefined;
}

/** What a Panel's tab says until its View says otherwise. */
export function viewTitle({ kind }: Address): string {
  return viewKind(kind)?.name ?? kind;
}
