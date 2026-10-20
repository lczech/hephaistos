import type { ComponentType } from "react";
import type { Params } from "./address";
import { ChangesView } from "./changes/ChangesView";
import { ConfigView } from "./config/ConfigView";
import { DaemonView } from "./daemon/DaemonView";
import { DbView } from "./db/DbView";
import { DiffView } from "./diff/DiffView";
import { EventsView } from "./events/EventsView";
import { HistoryView } from "./history/HistoryView";
import type { KindName } from "./kinds";
import { LogView } from "./log/LogView";
import { RepositoriesView } from "./repositories/RepositoriesView";

/** What a View gets: its parameters, and ways to change them and what its tab says. */
export interface ViewProps {
  params: Params;
  // Shows others instead, e.g. when filtered; `typed`: by a key, going on with the step of the
  // key before (`layout/visits.ts`).
  setParams: (params: Params, typed?: boolean) => void;
  setTitle: (title: string) => void; // if not just the kind's name
}

type View = ComponentType<ViewProps>;

/** Each kind's View. Views know nothing of Panels: `layout/` places them. */
export const VIEWS: Record<string, View> = {
  repositories: RepositoriesView,
  daemon: DaemonView,
  events: EventsView,
  changes: ChangesView,
  diff: DiffView,
  history: HistoryView,
  log: LogView,
  config: ConfigView,
  db: DbView,
} satisfies Record<KindName, View>;

export function viewComponent(kind: string): View | undefined {
  return Object.hasOwn(VIEWS, kind) ? VIEWS[kind] : undefined;
}
