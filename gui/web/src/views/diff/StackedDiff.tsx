import type { SortingState } from "@tanstack/react-table";
import { type ReactNode, useEffect, useState } from "react";
import type { ChangesQuery, DiffQuery } from "../../api/queries";
import { ListTable } from "../../components/table/ListTable";
import changesStyles from "../changes/ChangesView.module.css";
import { Lines } from "../changes/columns";
import { type Folds, foldedBy, withFolded } from "../changes/folds";
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
import type { FileFind } from "./diffFind";
import { type DiffShow, DirectorySection, FileBody, FileSection } from "./FileSection";

const BY_PATH: SortingState = [{ id: "path", desc: false }];

/** The files' rows in the order a list shows them, those within rows too; not folders. */
function filesOf(rows: Entry[]): Extract<Entry, { type: "change" }>[] {
  return rows.flatMap((row) =>
    row.type === "change" && !isFolder(row.change) ? [row] : filesOf(row.subRows),
  );
}

const isUntracked = (change: Change) => change.status === "?";

/** The stack's rows: its directories and files, without the groups' rows, as a stack compares
 * two Revisions; not untracked files, which are listed apart. */
function stackRows(groups: Group[], nested: boolean): Entry[] {
  const tracked = groups.map((group) => ({
    ...group,
    changes: group.changes.filter((change) => !isUntracked(change)),
  }));
  return entries(tracked, () => undefined, BY_PATH, nested).flatMap((row) => row.subRows);
}

/** The stack's files in its order, but untracked ones. */
export function stackedPaths(groups: Group[], nested: boolean): string[] {
  return filesOf(stackRows(groups, nested)).map((row) => row.change.path);
}

interface Props {
  groups: Group[]; // the changes compared, as `/api/changes` has them
  query: ChangesQuery; // which, to ask for the files in new folders
  base: Omit<DiffQuery, "path">; // each file's diff, but its path
  show: DiffShow;
  nested: boolean; // directories in their parents, as Changes lists them
  folded: Folds; // files and directories only their headers show of, kept per Checkout
  onFoldedChange: (folded: Folds) => void;
  findIn?: (path: string) => FileFind | undefined; // what each file's diff marks
  onUntrackedOpen?: (paths: readonly string[]) => void; // the untracked files open, in order
}

/**
 * All files' diffs of a comparison or commit, one under the other in the order Changes lists
 * them, under their directories' headers (nested, theirs too), each asked for as it comes near;
 * untracked files last, listed, each shown on asking. Files and directories fold.
 */
export function StackedDiff(props: Props) {
  const { groups, base, show, nested, folded, onFoldedChange, findIn } = props;
  const rows = stackRows(groups, nested);
  const untracked = groups.flatMap((group) => {
    const changes = group.changes.filter(isUntracked);
    return changes.length > 0 ? [{ ...group, changes, count: changes.length }] : [];
  });
  // Groups cut at the setting's cap, which their lists reached.
  const cut = groups.filter((group) => group.count > group.changes.length);
  const more = cut.reduce((sum, group) => sum + group.count - group.changes.length, 0);
  const fold = (path: string) => (on: boolean) =>
    onFoldedChange({ ...folded, paths: withFolded(folded.paths, path, on) });
  const stacked = (within: Entry[]): ReactNode =>
    within.map((row) => {
      if (row.type === "directory") {
        // Folded by a directory above it, where each shows by its path.
        const by = foldedBy(folded.paths, row.path);
        return (
          <DirectorySection
            key={row.path}
            entry={row}
            folded={by !== undefined}
            foldedWith={by === row.path ? undefined : by}
            onFoldedChange={fold(row.path)}
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
          folded={folded.paths.has(row.change.path)}
          onFoldedChange={fold(row.change.path)}
          find={findIn?.(row.change.path)}
        />
      );
    });
  return (
    <>
      <Totals groups={groups} />
      {stacked(rows)}
      {untracked.length > 0 && <Untracked {...props} groups={untracked} />}
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

interface UntrackedProps extends Omit<Props, "groups"> {
  groups: Group[]; // with only the untracked files and new folders
}

/**
 * Untracked files and new folders, which may be anything left lying about: listed as Changes
 * lists them, a file's diff shown below its row once opened, or all of them at once.
 */
function Untracked(props: UntrackedProps) {
  const { groups, query, base, show, nested, folded, onFoldedChange, findIn, onUntrackedOpen } =
    props;
  const [sorted, setSorted] = useState(BY_PATH);
  const { table, folds, listed, openAll } = useChangesTable({
    query,
    groups,
    folded,
    onFoldedChange,
    sorted,
    onSortedChange: setSorted,
    ungrouped: true,
    nested,
  });
  // All shown: every file's row open, those found in new folders too, but those closed again.
  const [all, setAll] = useState(false);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const files = filesOf(listed);
  const ids = files.map(entryId);
  const open = all ? new Set(ids.filter((id) => !closed.has(id))) : opened;
  // Told as the files open change, e.g. to find in them; none once gone.
  const openFiles = files.flatMap((row) => (open.has(entryId(row)) ? [row.change.path] : []));
  const said = openFiles.join("\0");
  useEffect(() => onUntrackedOpen?.(said === "" ? [] : said.split("\0")), [said, onUntrackedOpen]);
  useEffect(() => () => onUntrackedOpen?.([]), [onUntrackedOpen]);
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
              find={findIn?.(entry.change.path)}
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
