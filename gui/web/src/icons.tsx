// Monochrome icons (Lucide) for what Events do and what they are about. Each entity has its own,
// a Machine by its chassis; the Registry actions show the icon of the entity with + and −, where
// it has them, else a square with them; git adding and removing, a diamond, after the git logo;
// what an observation finds, a circle (docs/gui/looks.md).

import {
  ArchiveRestore,
  ArrowDownToLine,
  ArrowRightLeft,
  ArrowUpFromLine,
  Book,
  BookMinus,
  BookPlus,
  Box,
  CircleCheck,
  CircleChevronUp,
  CircleQuestionMark,
  Cloud,
  Computer,
  Cpu,
  DiamondMinus,
  DiamondPlus,
  Dot,
  FolderGit2,
  FolderMinus,
  FolderPlus,
  FolderSymlink,
  GitBranch,
  GitBranchMinus,
  GitBranchPlus,
  GitCommitVertical,
  GitMerge,
  GitPullRequestArrow,
  Globe,
  HardDrive,
  Laptop,
  type LucideIcon,
  Monitor,
  MoveRight,
  Pencil,
  Server,
  Smartphone,
  SquareMinus,
  SquarePlus,
  Tablet,
  Tag,
  TriangleAlert,
  Undo2,
  Watch,
} from "lucide-react";
import { FolderBranch } from "./drawnIcons";

/** What an Event of this kind did: `clone.branch_created` → `branch created`. */
export function actionOf(kind: string): string {
  const [, action = kind] = kind.split(/\.(.*)/s);
  return action.replaceAll("_", " ");
}

// Every Event kind has one, of its own or of its action: tests/core/events/test_kinds.py.
const KINDS: Record<string, LucideIcon> = {
  "repository.registered": BookPlus,
  "repository.unregistered": BookMinus,
  "clone.registered": FolderPlus,
  "clone.unregistered": FolderMinus,
};

const ACTIONS: Record<string, LucideIcon> = {
  registered: SquarePlus,
  unregistered: SquareMinus,
  added: DiamondPlus,
  removed: DiamondMinus,
  restored: ArchiveRestore,
  changed: Pencil,
  moved: MoveRight,
  missing: CircleQuestionMark,
  found: CircleCheck,
  recovered: CircleCheck,
  failed: TriangleAlert,
  "branch created": GitBranchPlus,
  "branch deleted": GitBranchMinus,
  "branch renamed": GitBranch,
  "branch switched": ArrowRightLeft,
  committed: GitCommitVertical,
  merged: GitMerge,
  pulled: ArrowDownToLine,
  pushed: ArrowUpFromLine,
  rebased: GitPullRequestArrow,
  reset: Undo2,
  "head moved": CircleChevronUp,
  "remotes changed": Globe,
};

const ENTITIES: Record<string, LucideIcon> = {
  filesystem: HardDrive,
  mount: FolderSymlink,
  repository: Book,
  clone: FolderGit2,
  worktree: FolderBranch,
};

// systemd's chassis types; each has one: tests/core/events/test_kinds.py.
const CHASSIS: Record<string, LucideIcon> = {
  desktop: Monitor,
  laptop: Laptop,
  convertible: Laptop,
  server: Server,
  tablet: Tablet,
  handset: Smartphone,
  watch: Watch,
  embedded: Cpu,
  vm: Box,
  container: Box,
};

/** HEAD, the commit checked out: in pickers, ref badges and Events alike. */
export const HEAD_ICON = CircleChevronUp;

/** A commit: in lists, pickers and Events alike. */
export const COMMIT_ICON = GitCommitVertical;

/** A ref's icon by its kind, in pickers and badges alike. */
export const REF_ICONS: Record<"branch" | "remote" | "tag", LucideIcon> = {
  branch: GitBranch,
  remote: Cloud,
  tag: Tag,
};

/** The icon for the kind of an Event: its own, else that of its action, else a dot. */
export function kindIcon(kind: string): LucideIcon {
  return KINDS[kind] ?? ACTIONS[actionOf(kind)] ?? Dot;
}

/** The icon of an entity type (`clone`), a Machine's by its chassis; a dot for one without. */
export function entityIcon(type: string, chassis: string | null = null): LucideIcon {
  if (type === "machine") return (chassis !== null && CHASSIS[chassis]) || Computer;
  return ENTITIES[type] ?? Dot;
}
