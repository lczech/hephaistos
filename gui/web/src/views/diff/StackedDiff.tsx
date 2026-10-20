import type { SortingState } from "@tanstack/react-table";
import { useState } from "react";
import type { ChangesQuery, DiffQuery } from "../../api/queries";
import { ListTable } from "../../components/table/ListTable";
import {
  type Change,
  type Entry,
  entries,
  entryId,
  type Group,
  isFolder,
  kindCounts,
  moreText,
} from "../changes/rows";
import { useChangesTable } from "../changes/table";
import styles from "./DiffView.module.css";
import { type DiffShow, FileBody, FileSection } from "./FileSection";

const BY_PATH: SortingState = [{ id: "path", desc: false }];

/** The files' rows in the order a list shows them, those within rows too; not folders. */
function filesOf(rows: Entry[]): Extract<Entry, { type: "change" }>[] {
  return rows.flatMap((row) =>
    row.type === "change" && !isFolder(row.change) ? [row] : filesOf(row.subRows),
  );
}

const isUntracked = (change: Change) => change.status === "?";

interface Props {
  groups: Group[]; // the changes compared, as `/api/changes` has them
  query: ChangesQuery; // which, to ask for the files in new folders
  base: Omit<DiffQuery, "path">; // each file's diff, but its path
  show: DiffShow;
}

/**
 * All files' diffs of a comparison or commit, one under the other in the order Changes lists
 * them, each asked for as it comes near; untracked files last, listed, each shown on asking.
 */
export function StackedDiff({ groups, query, base, show }: Props) {
  const tracked = groups.map((group) => ({
    ...group,
    changes: group.changes.filter((change) => !isUntracked(change)),
  }));
  const files = filesOf(entries(tracked, () => undefined, BY_PATH));
  const untracked = groups.flatMap((group) => {
    const changes = group.changes.filter(isUntracked);
    return changes.length > 0 ? [{ ...group, changes, count: changes.length }] : [];
  });
  const listed = groups.reduce((sum, group) => sum + group.changes.length, 0);
  const count = groups.reduce((sum, group) => sum + group.count, 0);
  // Files collapsed to their headers, while this comparison shows.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const collapse = (path: string) => (on: boolean) =>
    setCollapsed((was) => {
      const next = new Set(was);
      if (on) next.add(path);
      else next.delete(path);
      return next;
    });
  return (
    <>
      {files.map(({ change }) => (
        <FileSection
          key={change.path}
          lazy
          query={{ ...base, path: change.path }}
          known={change}
          show={show}
          collapsed={collapsed.has(change.path)}
          onCollapsedChange={collapse(change.path)}
        />
      ))}
      {untracked.length > 0 && (
        <Untracked groups={untracked} query={query} base={base} show={show} />
      )}
      {count > listed && <p className={styles.note}>{moreText(listed, count)}.</p>}
    </>
  );
}

interface UntrackedProps extends Omit<Props, "groups"> {
  groups: Group[]; // with only the untracked files and new folders
}

/**
 * Untracked files and new folders, which may be anything left lying about: listed as Changes
 * lists them, a file's diff shown below its row once opened, or all of them at once.
 */
function Untracked({ groups, query, base, show }: UntrackedProps) {
  const [sorted, setSorted] = useState(BY_PATH);
  const { table, folds, listed, openAll } = useChangesTable({
    query,
    groups,
    sorted,
    onSortedChange: setSorted,
    ungrouped: true,
  });
  // All shown: every file's row open, those found in new folders too, but those closed again.
  const [all, setAll] = useState(false);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const ids = filesOf(listed).map(entryId);
  const open = all ? new Set(ids.filter((id) => !closed.has(id))) : opened;
  const showAll = () => {
    openAll();
    setAll(true);
    setClosed(new Set());
  };
  const counts = kindCounts(groups.flatMap((group) => group.changes))
    .map(
      ([kind, n]) => `${n} ${kind === "new folder" ? "new folder" : "file"}${n === 1 ? "" : "s"}`,
    )
    .join(", ");
  return (
    <section className={styles.untracked} aria-label="Untracked">
      <p className={styles.heading}>
        Untracked: {counts}
        {!all && (
          <button type="button" className={styles.action} onClick={showAll}>
            Show all
          </button>
        )}
      </p>
      <ListTable
        table={table}
        oneLine
        choices={{}}
        message={null}
        older="files"
        detailsLabel="Diff"
        details={(entry) =>
          entry.type === "change" && (
            <FileBody
              query={{ ...base, path: entry.change.path }}
              known={entry.change}
              show={show}
            />
          )
        }
        folds={folds}
        plain={(entry) => entry.type === "note"}
        opened={open}
        onOpenedChange={(next) => {
          if (all) setClosed(new Set(ids.filter((id) => !next.has(id))));
          else setOpened(next);
        }}
      />
    </section>
  );
}
