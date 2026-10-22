import {
  Activity,
  BookCopy,
  Calendar,
  Database,
  FileDiff,
  GitCommitVertical,
  GitCompareArrows,
  type LucideIcon,
  ScrollText,
  SlidersHorizontal,
} from "lucide-react";
import { FileDiffs } from "../drawnIcons";
import type { Address, Params } from "./address";
import { checkoutOf } from "./changes/checkout";

/** A kind of View: what it is called, and its icon. */
export interface ViewKind {
  name: string;
  icon: LucideIcon;
  iconOf?: (params: Params) => LucideIcon; // a View's own, if its parameters change it
}

const kinds = {
  repositories: { name: "Repositories", icon: BookCopy },
  events: { name: "Events", icon: Calendar },
  changes: { name: "Changes", icon: GitCompareArrows },
  diff: {
    name: "Diff",
    icon: FileDiff,
    // A Checkout's changes without a path: all files, one under the other.
    iconOf: (params) =>
      params.path === undefined && checkoutOf(params) !== undefined ? FileDiffs : FileDiff,
  },
  history: { name: "History", icon: GitCommitVertical },
  daemon: { name: "Daemon", icon: Activity },
  log: { name: "Log", icon: ScrollText },
  config: { name: "Config", icon: SlidersHorizontal },
  db: { name: "Database", icon: Database },
} satisfies Record<string, ViewKind>;

export type KindName = keyof typeof kinds;

/** Every kind of View the GUI has; `index.ts` gives each its component. */
export const KINDS: Record<KindName, ViewKind> = kinds;

export function viewKind(kind: string): ViewKind | undefined {
  return Object.hasOwn(KINDS, kind) ? KINDS[kind as KindName] : undefined;
}

/** A View's icon, in its tab and in links to it: its kind's, or as its parameters make it. */
export function viewIcon({ kind, params }: Address): LucideIcon | undefined {
  const known = viewKind(kind);
  return known?.iconOf?.(params) ?? known?.icon;
}

/** What a Panel's tab says until its View says otherwise. */
export function viewTitle({ kind }: Address): string {
  return viewKind(kind)?.name ?? kind;
}
