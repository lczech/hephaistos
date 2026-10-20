import type { SortingState } from "@tanstack/react-table";
import { type ReactNode, useState } from "react";
import type { ChangesQuery, DiffQuery } from "../../api/queries";
import { ListTable } from "../../components/table/ListTable";
import changesStyles from "../changes/ChangesView.module.css";
import { Lines } from "../changes/columns";
import {
  type Change,
  type Entry,
  entries,
  entryId,
  filesText,
  type Group,
  isFolder,
  kindCounts,
  moreText,
  totals,
} from "../changes/rows";
import { useChangesTable } from "../changes/table";
import styles from "./DiffView.module.css";
import { type DiffShow, DirectorySection, FileBody, FileSection } from "./FileSection";

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
  nested: boolean; // directories in their parents, as Changes lists them
  collapsed: ReadonlySet<string>; // files and directories (`dir/`) only their headers show of
  onCollapsedChange: (collapsed: ReadonlySet<string>) => void;
}

/**
 * All files' diffs of a comparison or commit, one under the other in the order Changes lists
 * them, under their directories' headers (nested, theirs too), each asked for as it comes near;
 * untracked files last, listed, each shown on asking. Files and directories collapse.
 */
export function StackedDiff(props: Props) {
  const { groups, query, base, show, nested, collapsed, onCollapsedChange } = props;
  const tracked = groups.map((group) => ({
    ...group,
    changes: group.changes.filter((change) => !isUntracked(change)),
  }));
  // Their directories and files, without the groups' rows: the stack compares two Revisions.
  const rows = entries(tracked, () => undefined, BY_PATH, nested).flatMap((row) => row.subRows);
  const untracked = groups.flatMap((group) => {
    const changes = group.changes.filter(isUntracked);
    return changes.length > 0 ? [{ ...group, changes, count: changes.length }] : [];
  });
  // Groups cut at the setting's cap, which their lists reached.
  const cut = groups.filter((group) => group.count > group.changes.length);
  const more = cut.reduce((sum, group) => sum + group.count - group.changes.length, 0);
  const collapse = (path: string) => (on: boolean) => {
    const next = new Set(collapsed);
    if (on) next.add(path);
    else next.delete(path);
    onCollapsedChange(next);
  };
  const stacked = (within: Entry[]): ReactNode =>
    within.map((row) => {
      if (row.type === "directory") {
        return (
          <DirectorySection
            key={row.path}
            entry={row}
            collapsed={collapsed.has(row.path)}
            onCollapsedChange={collapse(row.path)}
          >
            {stacked(row.subRows)}
          </DirectorySection>
        );
      }
      if (row.type !== "change" || isFolder(row.change)) return null; // more: said at the end
      return (
        <FileSection
          key={row.change.path}
          lazy
          query={{ ...base, path: row.change.path }}
          known={row.change}
          show={show}
          collapsed={collapsed.has(row.change.path)}
          onCollapsedChange={collapse(row.change.path)}
        />
      );
    });
  return (
    <>
      <Totals groups={groups} />
      {stacked(rows)}
      {untracked.length > 0 && (
        <Untracked groups={untracked} query={query} base={base} show={show} nested={nested} />
      )}
      {more > 0 && (
        <p className={styles.note}>
          {moreText(more, Math.max(...cut.map((group) => group.changes.length)))}.
        </p>
      )}
    </>
  );
}

/** All files' totals, lined up with their headers' lines, above them. */
function Totals({ groups }: { groups: Group[] }) {
  return (
    <div className={styles.totals}>
      <span className={styles.end}>
        <span className={styles.aside}>Total: {filesText(groups)}</span>
        <Lines {...totals(groups.flatMap((group) => group.changes))} />
        <span className={styles.linkRoom} /> {/* as the files' links take */}
      </span>
    </div>
  );
}

interface UntrackedProps extends Omit<Props, "groups" | "collapsed" | "onCollapsedChange"> {
  groups: Group[]; // with only the untracked files and new folders
}

/**
 * Untracked files and new folders, which may be anything left lying about: listed as Changes
 * lists them, a file's diff shown below its row once opened, or all of them at once.
 */
function Untracked({ groups, query, base, show, nested }: UntrackedProps) {
  const [sorted, setSorted] = useState(BY_PATH);
  const { table, folds, listed, openAll } = useChangesTable({
    query,
    groups,
    sorted,
    onSortedChange: setSorted,
    ungrouped: true,
    nested,
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
        className={changesStyles.columns}
        oneLine
        choices={{}}
        message={null}
        older="files"
        detailsLabel="Diff"
        bareDetails // across the list's width, as the files' diffs above
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
