import {
  Activity,
  Calendar,
  Database,
  FileDiff,
  FolderGit2,
  GitCommitVertical,
  GitCompareArrows,
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
  repositories: { name: "Repositories", icon: FolderGit2, suggested: true },
  events: { name: "Events", icon: Calendar, suggested: true },
  changes: { name: "Changes", icon: GitCompareArrows },
  diff: { name: "Diff", icon: FileDiff },
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

/** What a Panel's tab says until its View says otherwise. */
export function viewTitle({ kind }: Address): string {
  return viewKind(kind)?.name ?? kind;
}
