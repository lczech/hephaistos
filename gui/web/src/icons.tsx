// Monochrome icons (Lucide) for what Events do and what they're about.

import {
  ArchiveRestore,
  ArrowDownToLine,
  ArrowRightLeft,
  ArrowUpFromLine,
  BookBookmark,
  CircleCheck,
  CircleMinus,
  CirclePlus,
  CircleQuestionMark,
  Crosshair,
  Dot,
  FolderGit2,
  FolderSymlink,
  FolderTree,
  GitBranch,
  GitBranchMinus,
  GitBranchPlus,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequestArrow,
  Globe,
  HardDrive,
  Laptop,
  type LucideIcon,
  MoveRight,
  Pencil,
  TriangleAlert,
  Undo2,
} from "lucide-react";

/** What an Event of this kind did: `clone.branch_created` → `branch created`. */
export function actionOf(kind: string): string {
  const [, action = kind] = kind.split(/\.(.*)/s);
  return action.replaceAll("_", " ");
}

const ACTIONS: Record<string, LucideIcon> = {
  added: CirclePlus,
  deleted: CircleMinus,
  removed: CircleMinus,
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
  committed: GitCommitHorizontal,
  merged: GitMerge,
  pulled: ArrowDownToLine,
  pushed: ArrowUpFromLine,
  rebased: GitPullRequestArrow,
  reset: Undo2,
  "head moved": Crosshair,
  "remotes changed": Globe,
};

const ENTITIES: Record<string, LucideIcon> = {
  machine: Laptop,
  filesystem: HardDrive,
  mount: FolderSymlink,
  repository: BookBookmark,
  clone: FolderGit2,
  worktree: FolderTree,
};

/** The icon of an action, or a dot for one without its own. */
export function actionIcon(action: string): LucideIcon {
  return ACTIONS[action] ?? Dot;
}

/** The icon of an entity type (`clone`), or a dot for one without its own. */
export function entityIcon(type: string): LucideIcon {
  return ENTITIES[type] ?? Dot;
}
