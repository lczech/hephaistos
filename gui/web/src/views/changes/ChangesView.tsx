import { useQueryClient } from "@tanstack/react-query";
import { type ExpandedState, functionalUpdate } from "@tanstack/react-table";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Schemas } from "../../api/client";
import {
  type ChangesQuery,
  KEYS,
  useChanges,
  useChangesWithin,
  useRepositories,
} from "../../api/queries";
import { ListTable } from "../../components/table/ListTable";
import { useListTable } from "../../components/table/list";
import { columnWidths } from "../../components/table/widths";
import { type Params, paramValues } from "../address";
import type { ViewProps } from "../index";
import { branchText, branchTitle } from "../repositories/rows";
import { sortingOf, withSorting } from "../sorting";
import styles from "./ChangesView.module.css";
import { changesColumns } from "./columns";
import {
  type Change,
  changedLines,
  comparison,
  DEFAULT_SORT,
  type Entry,
  entries,
  entryId,
  type Group,
  isFolder,
  linesText,
  SORTS,
  totals,
  type Within,
} from "./rows";

type Repository = Schemas["RepositoryJson"];

const SINCE_HEAD = { from: "HEAD", to: "worktree" };

/** The Checkout the parameters name: a Clone or a Worktree, by ID. */
function checkoutOf(params: Params): ChangesQuery | undefined {
  const [clone] = paramValues(params.clone);
  const [worktree] = paramValues(params.worktree);
  if (clone !== undefined) return { clone };
  if (worktree !== undefined) return { worktree };
  return undefined;
}

/** A Checkout's short name, for the tab: its folder's, or its Worktree's. */
function checkoutName(
  repositories: Repository[] | undefined,
  query: ChangesQuery,
): string | undefined {
  for (const clone of repositories?.flatMap((repository) => repository.clones) ?? []) {
    if (clone.id === query.clone) return clone.path.split("/").at(-1);
    const worktree = clone.worktrees.find((found) => found.id === query.worktree);
    if (worktree !== undefined) return worktree.name;
  }
  return undefined;
}

/**
 * What changed in a Checkout, as git reads it now: in the groups `git status` shows, or from
 * one state to another (its parameters `from` and `to`: a commit, `index` or `worktree`).
 * Groups and directories open and close, and so do new folders, whose files are asked for once
 * opened.
 */
export function ChangesView({ params, setParams, setTitle }: ViewProps) {
  const checkout = checkoutOf(params);
  const compared = comparison(params);
  const query = { ...checkout, ...compared };
  const changes = useChanges(query);
  const client = useQueryClient();
  const repositories = useRepositories();
  const name = checkout && checkoutName(repositories.data, checkout);
  const title = name && `Changes: ${name}${compared ? `, ${compared.from} → ${compared.to}` : ""}`;
  useEffect(() => {
    if (title !== undefined) setTitle(title);
  }, [title, setTitle]);
  const groups = changes.data?.groups ?? [];

  const sorted = useMemo(() => sortingOf(params, SORTS, DEFAULT_SORT), [params]);
  // Groups and directories open until closed; new folders closed until opened.
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

  const listed = entries(groups, within, sorted);
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
    onSortingChange: (change) =>
      setParams(withSorting(params, functionalUpdate(change, sorted), DEFAULT_SORT)),
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

  let message: string | null = null;
  if (checkout === undefined) {
    message = "No Checkout: open Changes from a Clone or Worktree in Repositories.";
  } else if (changes.data === undefined) {
    message = changes.isError ? `No answer: ${changes.error.message}` : "Asking git…";
  } else if (groups.length === 0) {
    message = compared ? `No changes from ${compared.from} to ${compared.to}.` : "No changes.";
  }
  // Staged changes apart, as `git status` shows them, or all since HEAD together: a toggle,
  // unless other states are compared.
  const together = compared?.from === SINCE_HEAD.from && compared.to === SINCE_HEAD.to;
  const apart = compared === undefined;
  const toggleApart = () => {
    const { from: _, to: __, ...others } = params;
    setParams(apart ? { ...others, ...SINCE_HEAD } : others);
  };
  const branch = changes.data?.branch;
  const all = groups.flatMap((group) => group.changes);
  const { added, removed } = totals(all);
  const files = new Set(all.filter((change) => !isFolder(change)).map((change) => change.path))
    .size;
  return (
    <section className={styles.view}>
      <header className={styles.bar}>
        {apart || together ? (
          <button
            type="button"
            className={styles.toggle}
            aria-pressed={apart}
            onClick={toggleApart}
            title="In the groups `git status` shows: staged, not staged, untracked, unmerged; else all changes since the last commit in one list, a file staged and changed again once"
          >
            Groups
          </button>
        ) : (
          compared && (
            <span className={styles.compared}>
              {compared.from} → {compared.to}
            </span>
          )
        )}
        {branch && <span title={branchTitle(branch)}>{branchMoves(branch)}</span>}
        {changes.data !== undefined && groups.length > 0 && (
          <span className={styles.totals} title="Lines added and removed in all groups">
            {files} {files === 1 ? "file" : "files"}, {linesText(added, removed)}
          </span>
        )}
        <button
          type="button"
          className={styles.refresh}
          onClick={() => void client.invalidateQueries({ queryKey: KEYS.changes })}
          title="Refresh"
          aria-label="Refresh"
          data-busy={changes.isFetching || undefined}
        >
          <RefreshCw aria-hidden="true" />
        </button>
      </header>
      <ListTable
        table={table}
        className={styles.changes}
        oneLine
        choices={{}}
        message={message}
        stale={changes.isError || changes.isPlaceholderData}
        older="changes"
        detailsLabel="Details"
        details={() => null}
        folds={folds}
        plain={(entry) => !folds(entry)}
      />
    </section>
  );
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

/** The branch, and how far it is ahead of and behind its upstream: `main ↑2 ↓1`. */
function branchMoves(branch: Schemas["BranchJson"]): string {
  const moves = [branch.ahead ? `↑${branch.ahead}` : "", branch.behind ? `↓${branch.behind}` : ""];
  return [branchText(branch), ...moves].filter(Boolean).join(" ");
}
