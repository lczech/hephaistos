import {
  Activity,
  Calendar,
  Database,
  type LucideIcon,
  ScrollText,
  SlidersHorizontal,
} from "lucide-react";
import type { Address } from "./address";

/** A kind of View: what it is called, and its icon. */
export interface ViewKind {
  name: string;
  icon: LucideIcon;
  suggested?: boolean; // offered in an empty Group
}

const kinds = {
  daemon: { name: "Daemon", icon: Activity, suggested: true },
  events: { name: "Events", icon: Calendar, suggested: true },
  log: { name: "Log", icon: ScrollText, suggested: true },
  config: { name: "Config", icon: SlidersHorizontal },
  db: { name: "Database", icon: Database },
} satisfies Record<string, ViewKind>;

export type KindName = keyof typeof kinds;

/** Every kind of View the GUI has; `index.ts` gives each its component. */
export const KINDS: Record<KindName, ViewKind> = kinds;

export function viewKind(kind: string): ViewKind | undefined {
  return Object.hasOwn(KINDS, kind) ? KINDS[kind as KindName] : undefined;
}

/** What a Panel's tab says until its View says otherwise. */
export function viewTitle({ kind }: Address): string {
  return viewKind(kind)?.name ?? kind;
}
