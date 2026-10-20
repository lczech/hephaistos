import { type ExpandedState, functionalUpdate, type SortingState } from "@tanstack/react-table";
import { useCallback, useMemo, useState } from "react";
import { type ChangesQuery, useChangesWithin } from "../../api/queries";
import { useListTable } from "../../components/table/list";
import { columnWidths } from "../../components/table/widths";
import { changesColumns } from "./columns";
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
}

/**
 * The changes as a list's rows (`entries`), for a `ListTable`: groups and directories open until
 * closed; new folders closed until opened, their files asked for then. Also how to open all.
 */
export function useChangesTable({ query, groups, sorted, onSortedChange, ungrouped }: Options) {
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const opened = useMemo(
    () => openedRows(entries(groups, () => undefined, sorted)),
    [groups, sorted],
  );
  const expanded = { ...opened, ...toggled };
  const paths = groups.flatMap((group) =>
    group.changes
      .filter((change) => isFolder(change) && expanded[`${group.name}:${change.path}`])
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
  const grouped = entries(groups, within, sorted);
  const listed = ungrouped ? grouped.flatMap((group) => group.subRows) : grouped;
  const most = Math.max(
    0,
    ...groups.flatMap((group) => group.changes.map((change) => changedLines(change) ?? 0)),
  );
  // A group folds where there are several; one is just their header, always open.
  const several = groups.length > 1;
  const folds = useCallback(
    (entry: Entry) => (entry.type === "group" ? several : foldsWithin(entry)),
    [several],
  );
  const columns = useMemo(() => changesColumns(most, folds), [most, folds]);
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
      if (next === true) return;
      // A row closed is left out, so it would open again as groups and directories do.
      const closed = Object.fromEntries(Object.keys(opened).map((id) => [id, false]));
      setToggled({ ...closed, ...next });
    },
  });
  // Opens every row that holds rows, new folders too.
  const openAll = () => setToggled(allOpen(listed));
  return { table, folds, listed, openAll };
}

/** Whether a row other than a group holds rows: a directory, a new folder; files show all
 * they have. */
function foldsWithin(entry: Entry): boolean {
  return entry.type === "change" ? isFolder(entry.change) : entry.type === "directory";
}

/** The rows open unless closed: groups and directories, by their IDs. */
function openedRows(rows: Entry[]): Record<string, boolean> {
  const opened: Record<string, boolean> = {};
  for (const row of rows) {
    if (row.type === "group" || row.type === "directory") {
      opened[entryId(row)] = true;
      Object.assign(opened, openedRows(row.subRows));
    }
  }
  return opened;
}

/** Every row that holds rows, open, by their IDs. */
function allOpen(rows: Entry[]): Record<string, boolean> {
  const open: Record<string, boolean> = {};
  for (const row of rows) {
    if (row.type === "note") continue;
    if (row.type !== "change" || isFolder(row.change)) open[entryId(row)] = true;
    Object.assign(open, allOpen(row.subRows));
  }
  return open;
}
