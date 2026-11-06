import {
  Activity,
  BookCopy,
  Calendar,
  Database,
  FileDiff,
  Files,
  GitCompareArrows,
  type LucideIcon,
  ScrollText,
  SlidersHorizontal,
} from "lucide-react";
import { FileDiffs, GitCommits } from "../drawnIcons";
import type { Address, Params } from "./address";
import { checkoutOf } from "./checkout";

/** A family of Views, whose icons share a colour (`families.module.css`). */
export type ViewFamily = "overview" | "git" | "files" | "machine";

/** What a family's Views are about, as a menu names them. */
export const FAMILY_NAMES: Record<ViewFamily, string> = {
  overview: "overviews",
  git: "git",
  files: "files",
  machine: "this machine",
};

/**
 * Where a kind that stands alone, without what others are opened from (e.g. a Checkout), is
 * offered: in the View menu only, or also at hand, by each Group's "+" and in an empty Group.
 */
export type Offered = "menu" | "atHand";

/** A kind of View: what it is called, its icon, its family, and where it is offered. */
export interface ViewKind {
  name: string;
  icon: LucideIcon;
  family: ViewFamily;
  iconOf?: (params: Params) => LucideIcon; // a View's own, if its parameters change it
  offered?: Offered; // none: opened only from other Views
}

const kinds = {
  repositories: { name: "Repositories", icon: BookCopy, family: "overview", offered: "atHand" },
  events: { name: "Events", icon: Calendar, family: "overview", offered: "atHand" },
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
  explorer: { name: "Explorer", icon: Files, family: "files", offered: "menu" },
  daemon: { name: "Daemon", icon: Activity, family: "machine", offered: "menu" },
  log: { name: "Log", icon: ScrollText, family: "machine", offered: "menu" },
  config: { name: "Config", icon: SlidersHorizontal, family: "machine", offered: "menu" },
  db: { name: "Database", icon: Database, family: "machine", offered: "menu" },
} satisfies Record<string, ViewKind>;

export type KindName = keyof typeof kinds;

/** Every kind of View the GUI has; `index.ts` gives each its component. */
export const KINDS: Record<KindName, ViewKind> = kinds;

const NAMES = Object.keys(kinds) as KindName[];

/** The kinds at hand, by each Group's "+" and in an empty Group. */
export const AT_HAND: readonly KindName[] = NAMES.filter(
  (kind) => KINDS[kind].offered === "atHand",
);

/** The kinds the View menu offers, all that stand alone, by family, in `kinds`' order. */
export const MENU_FAMILIES: readonly { family: ViewFamily; kinds: readonly KindName[] }[] = [
  ...new Set(NAMES.map((kind) => KINDS[kind].family)),
]
  .map((family) => ({
    family,
    kinds: NAMES.filter((kind) => KINDS[kind].family === family && KINDS[kind].offered),
  }))
  .filter(({ kinds }) => kinds.length > 0);

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
