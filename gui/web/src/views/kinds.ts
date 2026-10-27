import {
  Activity,
  BookCopy,
  Calendar,
  Database,
  FileDiff,
  GitCompareArrows,
  type LucideIcon,
  ScrollText,
  SlidersHorizontal,
} from "lucide-react";
import { FileDiffs, GitCommits } from "../drawnIcons";
import type { Address, Params } from "./address";
import { checkoutOf } from "./changes/checkout";

/** A family of Views, whose icons share a colour (`families.module.css`). */
export type ViewFamily = "overview" | "git" | "machine";

/** A kind of View: what it is called, its icon, and its family. */
export interface ViewKind {
  name: string;
  icon: LucideIcon;
  family: ViewFamily;
  iconOf?: (params: Params) => LucideIcon; // a View's own, if its parameters change it
}

const kinds = {
  repositories: { name: "Repositories", icon: BookCopy, family: "overview" },
  events: { name: "Events", icon: Calendar, family: "overview" },
  changes: { name: "Changes", icon: GitCompareArrows, family: "git" },
  diff: {
    name: "Diff",
    icon: FileDiff,
    family: "git",
    // A Checkout's changes without a path: all files, one under the other.
    iconOf: (params) =>
      params.path === undefined && checkoutOf(params) !== undefined ? FileDiffs : FileDiff,
  },
  history: { name: "History", icon: GitCommits, family: "git" },
  daemon: { name: "Daemon", icon: Activity, family: "machine" },
  log: { name: "Log", icon: ScrollText, family: "machine" },
  config: { name: "Config", icon: SlidersHorizontal, family: "machine" },
  db: { name: "Database", icon: Database, family: "machine" },
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
