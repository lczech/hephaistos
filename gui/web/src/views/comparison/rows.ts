// The Changes list's rows: git's groups; within them, each directory with changes, holding
// its files' rows, then the files at the top; the files in a new folder once it is opened; and
// how they read. Directories show flat, each by its path, or nested, each in its parent.

import type { SortingState } from "@tanstack/react-table";
import type { Schemas } from "../../api/client";
import { directoriesBelow } from "../../components/files/paths";
import {
  inOrder,
  type Loaded,
  loadedRows,
  type Note,
  note,
  noteId,
  type Order,
} from "../../components/list/tree";
import { INDEX, revisionText, shortHash, WORKING_TREE } from "../../revisions";
import { counted, numberText, sizeText } from "../../text";
import { type Params, paramValues } from "../address";

export type Group = Schemas["ChangeGroupJson"];
export type Change = Schemas["ChangeJson"];
type GroupName = Group["name"];

/** The files within an opened folder: undefined while they are asked for. */
export type Within = Loaded<Change>;

/**
 * A row: all groups' totals; a group of changes; a directory with changes in it, all below it in
 * `changes`; a changed file or new folder; or a note, e.g. about more. Paths show without
 * `base`, which the rows around them say.
 */
export type Entry =
  | { type: "total"; groups: Group[]; subRows: [] }
  | { type: "group"; group: Group; subRows: Entry[] }
  | {
      type: "directory";
      group: Group;
      path: string;
      base: string;
      changes: Change[];
      subRows: Entry[];
    }
  | { type: "change"; group: Group; change: Change; base: string; subRows: Entry[] }
  | Note;

const GROUP_NAMES: Record<GroupName, string> = {
  unmerged: "Unmerged",
  staged: "Staged",
  unstaged: "Not staged",
  untracked: "Untracked",
  changes: "Changes",
};

export function groupName(group: Group): string {
  return GROUP_NAMES[group.name];
}

/** What happened to a file, as its icon and colour show it. */
export type Kind = "modified" | "added" | "deleted" | "renamed" | "conflict" | "new folder";

/** In the order a group's header counts them. */
export const KINDS: Kind[] = ["conflict", "modified", "renamed", "added", "new folder", "deleted"];

export function kindOf(change: Change): Kind {
  switch (change.status) {
    case "A":
      return "added";
    case "?":
      return isFolder(change) ? "new folder" : "added";
    case "D":
      return "deleted";
    case "R":
    case "C":
      return "renamed";
    case "U":
      return "conflict";
    default:
      return "modified"; // M, and T: its type changed, e.g. to a symlink
  }
}

const STATUS_NAMES: Record<string, string> = {
  A: "added",
  M: "modified",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "type changed",
  U: "unmerged",
  "?": "untracked",
};

/** git's letter spelled out: `M` → `modified`. */
export function letterName(letter: string): string {
  return STATUS_NAMES[letter] ?? letter;
}

/** git's letter for a change spelled out: `modified`. */
export function statusName(change: Change): string {
  return letterName(change.status);
}

/** How many of each kind these changes are, in `KINDS`' order, without those of none. */
export function kindCounts(changes: Change[]): [Kind, number][] {
  const counts = new Map<Kind, number>();
  for (const change of changes) {
    const kind = kindOf(change);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return KINDS.flatMap((kind) => {
    const count = counts.get(kind);
    return count ? [[kind, count] as [Kind, number]] : [];
  });
}

export function isFolder(change: Change): boolean {
  return change.path.endsWith("/");
}

/** What the row is about, by its ID, unique among all rows: a file may be in two groups. */
export function entryId(entry: Entry): string {
  if (entry.type === "total") return "total";
  if (entry.type === "group") return entry.group.name;
  if (entry.type === "directory") return `${entry.group.name}/${entry.path}`;
  if (entry.type === "change") return `${entry.group.name}:${entry.change.path}`;
  return entry.id;
}

/** Lines changed, to sort by: unknown for binary files, those too large, and folders. */
export function changedLines(change: Change): number | undefined {
  if (change.added === null || change.removed === null) return undefined;
  return change.added + change.removed;
}

/** Lines changed in a directory's files, those that have them; unknown if none has. */
function directoryLines(changes: Change[]): number | undefined {
  const counted = changes.flatMap((change) => changedLines(change) ?? []);
  return counted.length ? counted.reduce((sum, lines) => sum + lines, 0) : undefined;
}

// The order, as the fragment's `sort`: by path unless chosen otherwise.
export const DEFAULT_SORT = "path";
export const SORTS = ["path", "lines"];

/** Changes in order: folders first, then files, each as sorted; unknown lines last. */
const CHANGES: Order<Change> = {
  rank: (change) => (isFolder(change) ? 0 : 1),
  values: { path: (change) => change.path, lines: changedLines },
  fallback: "path",
};

/** Directories in order, by their paths or their files' lines; unknown lines last. */
const DIRECTORIES: Order<{ path: string; items: Change[] }> = {
  values: {
    path: (directory) => directory.path,
    lines: (directory) => directoryLines(directory.items),
  },
  fallback: "path",
};

/** That lists stop at the setting's cap, which those cut reached, not at their end. */
export function moreText(more: number, cap: number): string {
  return `${numberText(more)} more not listed, as the setting gui.diff.max_files allows ${numberText(cap)} per list`;
}

type WithinOf = (group: Group, folder: Change) => Within;

/** How rows are made: the files within new folders, their order, and how directories show. */
interface Making {
  within: WithinOf;
  sorted: SortingState;
  nested: boolean;
}

/** The rows of changes, their paths shown without `base`; a new folder holding its files. */
function changeRows(group: Group, changes: Change[], base: string, making: Making): Entry[] {
  return inOrder(changes, making.sorted, CHANGES).map((change) => ({
    type: "change",
    group,
    change,
    base,
    subRows: isFolder(change) ? withinRows(group, change, making) : [],
  }));
}

/**
 * The rows of changes below `base`: a row for each directory with changes in it, holding them,
 * then those directly in `base`. Nested, a directory holds its own the same way; one holding a
 * single directory and nothing else is one row with it, `src/hephaistos/`.
 */
function directoryRows(group: Group, changes: Change[], base: string, making: Making): Entry[] {
  const { sorted, nested } = making;
  const { directories, direct } = directoriesBelow(changes, (change) => change.path, base, nested);
  const rows = inOrder(directories, sorted, DIRECTORIES).map(
    ({ path, items }): Entry => ({
      type: "directory",
      group,
      path,
      base,
      changes: items,
      subRows: nested
        ? directoryRows(group, items, path, making)
        : changeRows(group, items, path, making),
    }),
  );
  return [...rows, ...changeRows(group, direct, base, making)];
}

/** The rows within a folder opened: its files, or that they are asked for, or why not. */
function withinRows(group: Group, folder: Change, making: Making): Entry[] {
  // Their own folders are not asked for: git lists their files.
  const inner = { ...making, within: () => undefined };
  return loadedRows(
    `${group.name}:${folder.path}`,
    making.within(group, folder),
    (changes) =>
      making.nested
        ? directoryRows(group, changes, folder.path, inner)
        : changeRows(group, changes, folder.path, inner),
    { more: moreText, loading: "Loading files…" },
  );
}

/**
 * The rows: each group, in git's order; within it, a row for each directory with changes in it,
 * holding them, then the changes at the top; new folders before files, each sorted. Nested,
 * directories hold theirs, and a new folder's files are in its directories too.
 */
export function entries(
  groups: Group[],
  within: WithinOf,
  sorted: SortingState,
  nested = false,
): Entry[] {
  return groups.map((group) => {
    const rows = directoryRows(group, group.changes, "", { within, sorted, nested });
    if (group.count > group.changes.length) {
      rows.push(
        note(
          noteId(group.name, "more"),
          moreText(group.count - group.changes.length, group.changes.length),
        ),
      );
    }
    return { type: "group", group, subRows: rows };
  });
}

/** The two revisions git has no name for, as the Server names them. */
/** Two revisions compared: a commit as git names it, `index` or `working-tree`. */
export type Compared = { from: string; to: string };

/** The changes compared, if the parameters say: from one revision to another. */
export function comparison(params: Params): Compared | undefined {
  const [from] = paramValues(params.from);
  const [to] = paramValues(params.to);
  return from !== undefined && to !== undefined ? { from, to } : undefined;
}

/** Two revisions compared, in words: `HEAD → working tree`. */
export function arrowText({ from, to }: Compared): string {
  return `${revisionText(from)} → ${revisionText(to)}`;
}

/** Two revisions compared, in words where git's status has them: `staged`. */
export function comparedText(compared: Compared): string {
  const { from, to } = compared;
  if (from === "HEAD" && to === INDEX) return "staged";
  if (from === INDEX && to === WORKING_TREE) return "not staged";
  if (from === "HEAD" && to === WORKING_TREE) return "since HEAD";
  return arrowText(compared);
}

/** Changes in words, lowercase, as links to their Changes name them: `staged changes`,
 * `uncommitted changes`, `changes from main to HEAD`, `changes in commit abc1234`. */
export function changesText(changes: Compared | { commit: string }): string {
  if ("commit" in changes) return `changes in commit ${shortHash(changes.commit)}`;
  const text = comparedText(changes);
  if (text === "staged") return "staged changes";
  if (text === "not staged") return "unstaged changes";
  if (text === "since HEAD") return "uncommitted changes";
  return `changes from ${revisionText(changes.from)} to ${revisionText(changes.to)}`;
}

/** That there are none of these changes: `No staged changes.`, `No changes from main to HEAD.` */
export function noChanges(changes: Compared | { commit: string }): string {
  return `No ${changesText(changes)}.`;
}

/** What changed in a file, if not its lines: `binary, 1.2 → 1.4 MB`, `12 MB, not counted`. */
export function otherText(change: Change): string | undefined {
  const { size, old_size: old } = change;
  if (change.files !== null) {
    return `${counted(change.files, "file", change.more_files)}, ${sizeText(size ?? 0)}`;
  }
  if (change.binary) {
    if (size !== null && old !== null && size !== old) {
      return `binary, ${sizeText(old)} → ${sizeText(size)}`;
    }
    const either = size ?? old;
    return either === null ? "binary" : `binary, ${sizeText(either)}`;
  }
  if (change.added === null)
    return size === null ? "not counted" : `${sizeText(size)}, not counted`;
  return undefined;
}

/**
 * How many files the groups list, a file in two once: `3 files`; and how many more they have
 * than listed, whose lines are unknown: `(649 more not listed)`.
 */
export function filesText(groups: Group[]): string {
  const changes = groups.flatMap((group) => group.changes);
  const files = new Set(changes.filter((change) => !isFolder(change)).map((change) => change.path))
    .size;
  const text = counted(files, "file");
  const more = groups.reduce((sum, group) => sum + group.count - group.changes.length, 0);
  return more > 0 ? `${text} (${numberText(more)} more not listed)` : text;
}

/** Lines added and removed in these changes, which have them. */
export function totals(changes: Change[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const change of changes) {
    added += change.added ?? 0;
    removed += change.removed ?? 0;
  }
  return { added, removed };
}
