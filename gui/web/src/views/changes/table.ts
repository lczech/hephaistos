import { type ExpandedState, functionalUpdate, type SortingState } from "@tanstack/react-table";
import { type ChangesQuery, useChangesWithin } from "../../api/queries";
import { useListTable } from "../../components/table/list";
import { columnWidths } from "../../components/table/widths";
import { changesColumns } from "./columns";
import { type Folds, foldedBy, unfolding, withFolded } from "./folds";
import {
  type Change,
  changedLines,
  type Entry,
  entries,
  entryId,
  type Group,
  isFolder,
  type Within,
} from "./rows";

interface Options {
  query: ChangesQuery; // the groups', to ask for the files in new folders
  groups: Group[];
  sorted: SortingState;
  onSortedChange: (sorted: SortingState) => void;
  ungrouped?: boolean; // the groups' rows without a row for each group
  nested?: boolean; // directories in their parents, not each by its path
  totalled?: boolean; // all groups' totals in a first row
  folded: Folds; // what is folded and opened, kept per Checkout
  onFoldedChange: (folded: Folds) => void;
}

/**
 * The changes as a list's rows (`entries`), for a `ListTable`: groups and directories open until
 * folded; new folders closed until opened, their files asked for then; both as `folded` keeps
 * them. Also how to open all.
 */
export function useChangesTable(options: Options) {
  const { query, groups, sorted, onSortedChange, ungrouped, nested, totalled } = options;
  const { folded, onFoldedChange } = options;
  // New folders are closed until opened, so only those opened are asked about.
  const paths = groups.flatMap((group) =>
    group.changes
      .filter((change) => isFolder(change) && folded.opened.has(change.path))
      .map((change) => change.path),
  );
  const answers = useChangesWithin(query, paths);
  const within = (group: Group, folder: Change): Within => {
    const answer = answers[paths.indexOf(folder.path)];
    if (answer === undefined || answer.data === undefined) {
      return answer?.isError ? { error: answer.error.message } : undefined;
    }
    const found = answer.data.groups.filter((other) => other.name === group.name);
    return {
      changes: found.flatMap((other) => other.changes),
      count: found.reduce((sum, other) => sum + other.count, 0),
    };
  };
  const grouped = entries(groups, within, sorted, nested);
  // Directories in new folders too, once their files are there.
  const holding = holdingRows(grouped);
  const expanded = Object.fromEntries(
    [...holding].map(([id, entry]) => [id, isOpen(entry, folded)]),
  );
  const total: Entry[] =
    totalled && groups.length > 0 ? [{ type: "total", groups, subRows: [] }] : [];
  const listed = [...total, ...(ungrouped ? grouped.flatMap((group) => group.subRows) : grouped)];
  const most = Math.max(0, ...linesListed(grouped));
  // A group folds where there are several; one is just their header, always open.
  const several = groups.length > 1;
  const folds = (entry: Entry) => (entry.type === "group" ? several : foldsWithin(entry));
  const columns = changesColumns(most, folds, ungrouped ? 0 : 1);
  // Every row that holds rows open, new folders too.
  const openAll = () => onFoldedChange(opening(folded, [...holding.values()]));
  const table = useListTable({
    columns,
    data: listed,
    getRowId: entryId,
    getSubRows: (entry) => entry.subRows,
    atoms: { columnSizing: columnWidths("changes") },
    state: { sorting: sorted, expanded },
    manualSorting: true, // in each group, which keep git's order
    onSortingChange: (change) => onSortedChange(functionalUpdate(change, sorted)),
    enableSortingRemoval: false,
    autoResetExpanded: false, // what is open stays so when git is asked again
    onExpandedChange: (change) => {
      const next: ExpandedState = functionalUpdate(change, expanded);
      if (next === true) return openAll();
      let changed = folded;
      for (const [id, entry] of holding) {
        const open = next[id] === true;
        if (open !== expanded[id]) changed = toggled(changed, entry, open);
      }
      onFoldedChange(changed);
    },
  });
  return { table, folds, listed, openAll };
}

/** Whether a row that holds rows is open: a group or directory unless folded, a new folder if
 * opened. */
function isOpen(entry: Entry, folded: Folds): boolean {
  if (entry.type === "group") return !folded.groups.has(entry.group.name);
  if (entry.type === "directory") return foldedBy(folded.paths, entry.path) === undefined;
  return entry.type === "change" && folded.opened.has(entry.change.path);
}

/** The folds with a row that holds rows opened or closed. */
function toggled(folded: Folds, entry: Entry, open: boolean): Folds {
  if (entry.type === "group") {
    const groups = new Set(folded.groups);
    if (open) groups.delete(entry.group.name);
    else groups.add(entry.group.name);
    return { ...folded, groups };
  }
  if (entry.type === "directory") {
    return { ...folded, paths: withFolded(folded.paths, entry.path, !open) };
  }
  if (entry.type !== "change") return folded;
  const opened = new Set(folded.opened);
  if (open) opened.add(entry.change.path);
  else opened.delete(entry.change.path);
  return { ...folded, opened };
}

/** The folds with all these rows open: groups and directories unfolded, new folders opened. */
function opening(folded: Folds, rows: Entry[]): Folds {
  const names = new Set<string>(
    rows.flatMap((row) => (row.type === "group" ? [row.group.name] : [])),
  );
  const folders = rows.flatMap((row) => (row.type === "change" ? [row.change.path] : []));
  const directories = rows.flatMap((row) => (row.type === "directory" ? [row.path] : []));
  return {
    paths: unfolding(folded.paths, directories),
    groups: new Set([...folded.groups].filter((name) => !names.has(name))),
    opened: new Set([...folded.opened, ...folders]),
  };
}

/** Each file's lines changed, as far as known, those in new folders opened too. */
function linesListed(rows: Entry[]): number[] {
  return rows.flatMap((row) => [
    ...(row.type === "change" ? [changedLines(row.change) ?? 0] : []),
    ...linesListed(row.subRows),
  ]);
}

/** Whether a row other than a group holds rows: a directory, a new folder; files show all
 * they have. */
function foldsWithin(entry: Entry): boolean {
  return entry.type === "change" ? isFolder(entry.change) : entry.type === "directory";
}

/** The rows that hold rows, by their IDs: groups, directories, new folders, those in new folders
 * too. */
function holdingRows(rows: Entry[]): Map<string, Entry> {
  const holding = new Map<string, Entry>();
  for (const row of rows) {
    if (row.type === "note" || row.type === "total") continue;
    if (row.type !== "change" || isFolder(row.change)) holding.set(entryId(row), row);
    for (const [id, entry] of holdingRows(row.subRows)) holding.set(id, entry);
  }
  return holding;
}
