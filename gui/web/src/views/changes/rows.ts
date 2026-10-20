// The Changes list's rows: git's groups; within them, each directory with changes, holding
// its files' rows, then the files at the top; the files in a new folder once it is opened; and
// how they read. Directories show flat, each by its path, or nested, each in its parent.

import type { SortingState } from "@tanstack/react-table";
import type { Schemas } from "../../api/client";
import { revisionText } from "../../revisions";
import { type Params, paramValues } from "../address";

export type Group = Schemas["ChangeGroupJson"];
export type Change = Schemas["ChangeJson"];
type GroupName = Group["name"];

/** The files within an opened folder: undefined while they are asked for. */
export type Within = { changes: Change[]; count: number } | { error: string } | undefined;

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
  | { type: "note"; id: string; text: string; subRows: [] };

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

/** git's letter for a change spelled out: `modified`. */
export function statusName(change: Change): string {
  return STATUS_NAMES[change.status] ?? change.status;
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

/** A path's folder, with its `/`, and its name: `src/`, `main.py`; a folder's own name ends in `/`. */
export function pathParts(path: string): [string, string] {
  const cut = path.lastIndexOf("/", path.length - 2) + 1;
  return [path.slice(0, cut), path.slice(cut)];
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

// The order, as the parameter `sort`: by path unless chosen otherwise.
export const DEFAULT_SORT = "path";
export const SORTS = ["path", "lines"];

/** An order of rows by their paths or lines; unknown lines last, either way. */
function compare<T>(
  sorted: SortingState,
  path: (row: T) => string,
  lines: (row: T) => number | undefined,
): (a: T, b: T) => number {
  const [{ id, desc } = { id: DEFAULT_SORT, desc: false }] = sorted;
  const byPath = (a: T, b: T) => (path(a) < path(b) ? -1 : path(a) > path(b) ? 1 : 0);
  const sign = desc ? -1 : 1;
  if (id !== "lines") return (a, b) => sign * byPath(a, b);
  return (a, b) => {
    const [x, y] = [lines(a), lines(b)];
    if (x === y) return byPath(a, b);
    if (x === undefined) return 1;
    if (y === undefined) return -1;
    return sign * (x - y);
  };
}

/** Changes in order: folders first, then files, each as sorted. */
function ordered(changes: Change[], sorted: SortingState): Change[] {
  const order = compare<Change>(sorted, (change) => change.path, changedLines);
  return [...changes].sort((a, b) => Number(isFolder(b)) - Number(isFolder(a)) || order(a, b));
}

function note(id: string, text: string): Entry {
  return { type: "note", id, text, subRows: [] };
}

/** That lists stop at the setting's cap, which those cut reached, not at their end. */
export function moreText(more: number, cap: number): string {
  return `${more.toLocaleString("en")} more not listed, as the setting gui.diff.max_files allows ${cap.toLocaleString("en")} per list`;
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
  return ordered(changes, making.sorted).map((change) => ({
    type: "change",
    group,
    change,
    base,
    subRows: isFolder(change) ? withinRows(group, change, making) : [],
  }));
}

/** The directory a change below `base` is shown in: by its path, or nested, the next one. */
function directoryOf(change: Change, base: string, nested: boolean): string {
  if (!nested) return pathParts(change.path)[0];
  const rest = change.path.slice(base.length);
  const cut = rest.indexOf("/") + 1;
  return cut === 0 || cut === rest.length ? base : base + rest.slice(0, cut);
}

/**
 * The rows of changes below `base`: a row for each directory with changes in it, holding them,
 * then those directly in `base`. Nested, a directory holds its own the same way; one holding a
 * single directory and nothing else is one row with it, `src/hephaistos/`.
 */
function directoryRows(group: Group, changes: Change[], base: string, making: Making): Entry[] {
  const { sorted, nested } = making;
  const byDirectory = new Map<string, Change[]>();
  for (const change of changes) {
    const directory = directoryOf(change, base, nested);
    byDirectory.set(directory, [...(byDirectory.get(directory) ?? []), change]);
  }
  const order = compare<[string, Change[]]>(
    sorted,
    ([path]) => path,
    ([, changes]) => directoryLines(changes),
  );
  const directories = [...byDirectory]
    .filter(([path]) => path !== base)
    .map(([path, changes]): [string, Change[]] => [nested ? joined(path, changes) : path, changes])
    .sort(order)
    .map(
      ([path, changes]): Entry => ({
        type: "directory",
        group,
        path,
        base,
        changes,
        subRows: nested
          ? directoryRows(group, changes, path, making)
          : changeRows(group, changes, path, making),
      }),
    );
  return [...directories, ...changeRows(group, byDirectory.get(base) ?? [], base, making)];
}

/** A directory joined with those below it while it holds just one: `src/` → `src/hephaistos/`. */
function joined(path: string, changes: Change[]): string {
  const [first, ...others] = changes.map((change) => directoryOf(change, path, true));
  if (first === undefined || first === path || others.some((other) => other !== first)) {
    return path;
  }
  return joined(first, changes);
}

/** The rows within a folder opened: its files, or that they are asked for, or why not. */
function withinRows(group: Group, folder: Change, making: Making): Entry[] {
  const id = `${group.name}:${folder.path}:`;
  const within = making.within(group, folder);
  if (within === undefined) return [note(`${id}loading`, "Loading files…")];
  if ("error" in within) return [note(`${id}error`, `Couldn't load: ${within.error}`)];
  // Their own folders aren't asked for: git lists their files.
  const inner = { ...making, within: () => undefined };
  const rows = making.nested
    ? directoryRows(group, within.changes, folder.path, inner)
    : changeRows(group, within.changes, folder.path, inner);
  if (within.count > within.changes.length) {
    rows.push(
      note(`${id}more`, moreText(within.count - within.changes.length, within.changes.length)),
    );
  }
  return rows;
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
          `${group.name}:more`,
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

/** A size in bytes, as `512 B`, `3.4 kB`, `12 kB`, `1.2 MB`. */
export function sizeText(bytes: number): string {
  const units: [number, string][] = [
    [1e9, "GB"],
    [1e6, "MB"],
    [1e3, "kB"],
  ];
  for (const [size, unit] of units) {
    if (bytes >= size) {
      const value = bytes / size;
      return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${unit}`;
    }
  }
  return `${bytes} B`;
}

/** What changed in a file, if not its lines: `binary, 1.2 → 1.4 MB`, `12 MB, not counted`. */
export function otherText(change: Change): string | undefined {
  const { size, old_size: old } = change;
  if (change.files !== null) {
    const files = `${change.files.toLocaleString("en")}${change.more_files ? "+" : ""}`;
    return `${files} ${change.files === 1 && !change.more_files ? "file" : "files"}, ${sizeText(size ?? 0)}`;
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
  const text = `${files.toLocaleString("en")} ${files === 1 ? "file" : "files"}`;
  const more = groups.reduce((sum, group) => sum + group.count - group.changes.length, 0);
  return more > 0 ? `${text} (${more.toLocaleString("en")} more not listed)` : text;
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
