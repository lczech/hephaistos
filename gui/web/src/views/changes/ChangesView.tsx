import { useQueryClient } from "@tanstack/react-query";
import { useAtom } from "@tanstack/react-store";
import { type ExpandedState, functionalUpdate } from "@tanstack/react-table";
import { LayoutList, List } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Schemas } from "../../api/client";
import { KEYS, useChanges, useChangesWithin, useRepositories } from "../../api/queries";
import { ListTable } from "../../components/table/ListTable";
import { useListTable } from "../../components/table/list";
import { columnWidths } from "../../components/table/widths";
import { BarEnd, BarLine, Choice, Refresh, ViewBar } from "../../components/ViewBar";
import { HEAD, revisionText, shortHash, WORKING_TREE } from "../../revisions";
import { useNow } from "../../useNow";
import { type Address, type Params, paramValues } from "../address";
import { CommitBelow, CommitLine } from "../history/CommitHeader";
import type { ViewProps } from "../index";
import { useIsShown, useOpenView } from "../opening";
import { branchText, branchTitle } from "../repositories/rows";
import { sortingOf, withSorting } from "../sorting";
import { ViewLink } from "../ViewLink";
import styles from "./ChangesView.module.css";
import { ComparedPickers } from "./ComparedPickers";
import { checkoutName, checkoutOf } from "./checkout";
import { changesColumns } from "./columns";
import { changesLook } from "./look";
import {
  arrowText,
  type Change,
  type Compared,
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

const SINCE_HEAD = { from: HEAD, to: WORKING_TREE };

/**
 * What changed in a Checkout, as git reads it now: from one Revision to another (its parameters
 * `from` and `to`, picked in its bar), without them since HEAD, in the groups `git status` shows
 * unless chosen together; or what a commit changed (`commit`), its line in the bar instead.
 * Groups and directories open and close, and so do new folders, whose files are asked for once
 * opened.
 */
export function ChangesView({ params, setParams, setTitle }: ViewProps) {
  const checkout = checkoutOf(params);
  const [commit] = paramValues(params.commit);
  const picked = comparison(params) ?? SINCE_HEAD;
  const sinceHead = picked.from === SINCE_HEAD.from && picked.to === SINCE_HEAD.to;
  // Since HEAD, staged changes apart as `git status` shows them, unless chosen together.
  const [look, setLook] = useAtom(changesLook());
  const grouped = commit === undefined && sinceHead && look.grouped;
  const compared = commit === undefined && !grouped ? picked : undefined;
  const query = { ...checkout, ...(commit === undefined ? compared : { commit }) };
  const changes = useChanges(query);
  const client = useQueryClient();
  const repositories = useRepositories();
  const now = useNow(10_000);
  const name = checkout && checkoutName(repositories.data, checkout);
  const shown = changes.data?.commit;
  const [details, setDetails] = useState(false); // a commit's, below the bar
  let comparing = compared && !sinceHead ? `, ${arrowText(compared)}` : "";
  if (commit !== undefined) {
    const subject = shown?.commit?.subject;
    comparing = `, ${shortHash(commit)}${subject ? ` ${subject}` : ""}`;
  }
  const title = name && `Changes: ${name}${comparing}`;
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
  // A file's row opens its diff beside, as a preview, kept by a double click.
  const openView = useOpenView();
  const isShown = useIsShown();
  const diffOf = (entry: Entry): Address | undefined => {
    if (entry.type !== "change" || isFolder(entry.change) || checkout === undefined) return;
    const { group, change } = entry;
    const states: Params = commit === undefined ? { from: group.from, to: group.to } : { commit };
    return { kind: "diff", params: { ...checkout, ...states, path: change.path } };
  };
  const opens = (entry: Entry) => {
    const diff = diffOf(entry);
    return diff && ((keep: boolean) => openView(diff, { beside: true, preview: !keep }));
  };
  const showing = (entry: Entry) => {
    const diff = diffOf(entry);
    return diff !== undefined && isShown(diff);
  };
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
    message = changes.isError ? `Couldn't load: ${changes.error.message}` : "Loading changes…";
  } else if (commit !== undefined) {
    if (groups.length === 0 && shown?.commit) message = `No changes in ${shortHash(commit)}.`;
  } else if (groups.length === 0) {
    message =
      compared && !sinceHead
        ? `No changes from ${revisionText(compared.from)} to ${revisionText(compared.to)}.`
        : "No changes.";
  }
  const { from: _, to: __, commit: ___, ...others } = params;
  // Since HEAD as no `from` and `to`: one address for it.
  const compare = (next: Compared) =>
    setParams(
      next.from === SINCE_HEAD.from && next.to === SINCE_HEAD.to ? others : { ...others, ...next },
    );
  const branch = changes.data?.branch;
  // A commit's changes, to compare other Revisions from: its first parent to it.
  const [parent] = shown?.commit?.parents ?? [];
  const ofCommit = parent && shown?.commit ? { from: parent, to: shown.commit.hash } : undefined;
  const all = groups.flatMap((group) => group.changes);
  const { added, removed } = totals(all);
  const files = new Set(all.filter((change) => !isFolder(change)).map((change) => change.path))
    .size;
  return (
    <section className={styles.view}>
      <ViewBar>
        {checkout && commit === undefined && (
          <ComparedPickers
            checkout={checkout}
            compared={picked}
            onChange={compare}
            known={branch ? { head: branch.head, branch: branch.branch, refs: [] } : undefined}
          />
        )}
        {checkout && shown && (
          <CommitLine
            shown={shown}
            checkout={checkout}
            open={details}
            onToggle={() => setDetails(!details)}
            onCompare={ofCommit && (() => compare(ofCommit))}
          />
        )}
        {checkout && (
          <BarEnd>
            {commit === undefined && sinceHead && (
              <Choice
                label="Groups"
                on={look.grouped}
                onChange={(on) => setLook({ grouped: on })}
                ways={[
                  {
                    icon: LayoutList,
                    title:
                      "Show changes grouped like `git status`: staged, not staged, untracked, unmerged",
                  },
                  {
                    icon: List,
                    title: "Show all changes since the last commit in one list, each file once",
                  },
                ]}
              />
            )}
            <ViewLink
              address={{ kind: "history", params: checkout }}
              label="Commit history of this Checkout"
              opening={{ beside: true, preview: true }}
            />
            <Refresh
              busy={changes.isFetching}
              onClick={() => void client.invalidateQueries({ queryKey: KEYS.changes })}
            />
          </BarEnd>
        )}
        {changes.data !== undefined && (groups.length > 0 || branch) && (
          <BarLine>
            {groups.length > 0 && (
              <span className={styles.totals} title="Total lines added and removed">
                {files} {files === 1 ? "file" : "files"}, {linesText(added, removed)}
              </span>
            )}
            {branch && <span title={branchTitle(branch)}>{branchMoves(branch)}</span>}
          </BarLine>
        )}
      </ViewBar>
      {shown && checkout && (
        <CommitBelow shown={shown} checkout={checkout} now={now} open={details} />
      )}
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
        opens={opens}
        showing={showing}
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
