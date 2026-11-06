import {
  FileDiff,
  FileDigit,
  FileMinus,
  FilePen,
  FilePlus,
  FileWarning,
  FolderPlus,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { cssVars } from "../../components/cssVars";
import { DirectoryPath, Path } from "../../components/files/Path";
import { Indented, NoteText, TreeChevron } from "../../components/list/TreeCells";
import { listColumnHelper } from "../../components/list/table";
import { TextIcon } from "../../components/TextIcon";
import styles from "./changes.module.css";
import {
  type Change,
  changedLines,
  type Entry,
  filesText,
  groupName,
  type Kind,
  kindCounts,
  kindOf,
  otherText,
  statusName,
  totals,
} from "./rows";

const column = listColumnHelper<Entry>();

const ICONS: Record<Kind, LucideIcon> = {
  modified: FileDiff,
  added: FilePlus,
  deleted: FileMinus,
  renamed: FilePen,
  conflict: FileWarning,
  "new folder": FolderPlus,
};

/** What happened to a file, by its icon and colour; a binary file's icon says that instead. */
function KindIcon({ kind, title, binary }: { kind: Kind; title?: string; binary?: boolean }) {
  const Icon = binary ? FileDigit : ICONS[kind];
  return (
    <span className={styles.kind} data-kind={kind} title={title ?? kind}>
      <TextIcon icon={Icon} />
    </span>
  );
}

/** Lines added and removed, each as wide as most numbers, so that they line up in a column. */
export function Lines({ added, removed }: { added: number; removed: number }) {
  return (
    <span className={styles.lines}>
      <span className={styles.added}>+{added}</span>{" "}
      <span className={styles.removed}>−{removed}</span>
    </span>
  );
}

/** A bar as long as the lines' share of the most in any file: added, then removed. */
function Meter({ added, removed, most }: { added: number; removed: number; most: number }) {
  const shares = { "--added": most ? added / most : 0, "--removed": most ? removed / most : 0 };
  return <span className={styles.meter} style={cssVars(shares)} aria-hidden="true" />;
}

/** A file's lines added and removed, if counted. */
function counted(entry: Entry): { added: number; removed: number } | undefined {
  if (entry.type !== "change") return undefined;
  const { added, removed } = entry.change;
  return added === null || removed === null ? undefined : { added, removed };
}

/** A change's row: its path below what the rows around it say, after what happened to it. */
export function ChangePath({ change, base }: { change: Change; base: string }) {
  const renamed = change.original === null ? "" : `\nrenamed from ${change.original}`;
  return (
    <Path
      deleted={change.status === "D"}
      shown={change.path.slice(base.length)}
      title={`${change.path}${renamed}`}
      icon={
        <KindIcon
          kind={kindOf(change)}
          title={`${change.binary ? "binary, " : ""}${statusName(change)}`}
          binary={change.binary}
        />
      }
    />
  );
}

/** What a row below a group shows as its path. */
function pathCell(entry: Exclude<Entry, { type: "group" | "total" }>): ReactNode {
  switch (entry.type) {
    case "note":
      return <NoteText note={entry} />;
    case "directory":
      return <DirectoryPath shown={entry.path.slice(entry.base.length)} path={entry.path} />;
    default:
      return <ChangePath change={entry.change} base={entry.base} />;
  }
}

/** All the changes a row other than a file's sums up. */
function changesOf(entry: Exclude<Entry, { type: "change" | "note" }>): Change[] {
  if (entry.type === "total") return entry.groups.flatMap((group) => group.changes);
  return entry.type === "group" ? entry.group.changes : entry.changes;
}

/** A group's name, and how many of each kind of change it holds. */
function GroupName({ entry }: { entry: Extract<Entry, { type: "group" }> }) {
  return (
    <span className={styles.group}>
      {groupName(entry.group)}
      {kindCounts(entry.group.changes).map(([kind, count]) => (
        <span key={kind} className={styles.counted}>
          <KindIcon kind={kind} title={`${count} ${kind}`} />
          {count}
        </span>
      ))}
    </span>
  );
}

/**
 * The Changes list's columns: the path takes what the others leave, then the lines, then their
 * bars, as long as their share of `most`. Rows that `fold` have a chevron; rows below those at
 * depth `top`, the groups' own, are indented.
 */
export function changesColumns(most: number, folds: (entry: Entry) => boolean, top: number) {
  return column.columns([
    column.display({
      id: "square",
      // In line with the row's path: a tree's chevrons stand before their folders.
      cell: ({ row }) => (folds(row.original) ? <TreeChevron depth={row.depth - top} /> : ""),
      enableResizing: false,
      meta: { width: "var(--square)" },
    }),
    column.accessor((entry) => (entry.type === "change" ? entry.change.path : ""), {
      id: "path",
      header: "path",
      enableSorting: true,
      size: 360,
      meta: { identifies: true },
      cell: ({ row }) => {
        const entry = row.original;
        if (entry.type === "total")
          return <span className={styles.group}>Total: {filesText(entry.groups)}</span>;
        if (entry.type === "group") return <GroupName entry={entry} />;
        return <Indented depth={row.depth - top}>{pathCell(entry)}</Indented>;
      },
    }),
    column.accessor((entry) => (entry.type === "change" ? changedLines(entry.change) : undefined), {
      id: "lines",
      header: "lines",
      enableSorting: true,
      sortDescFirst: true,
      enableResizing: false,
      meta: {
        width: "max-content",
        end: true,
        description: "Lines added and removed; the size for binary or very large files",
      },
      cell: ({ row }) => {
        const entry = row.original;
        if (entry.type === "note") return "";
        if (entry.type !== "change") {
          const sum = totals(changesOf(entry));
          return (
            <span className={styles.total}>
              <Lines {...sum} />
            </span>
          );
        }
        const lines = counted(entry);
        if (lines === undefined)
          return <span className={styles.other}>{otherText(entry.change)}</span>;
        return <Lines {...lines} />;
      },
    }),
    column.display({
      id: "meter",
      enableResizing: false,
      // The row's padding at its end comes out of its last column, as the rows are subgrids.
      meta: { width: "calc(var(--meter-length) + var(--space-3))" },
      cell: ({ row }) => {
        const lines = counted(row.original);
        return lines && <Meter {...lines} most={most} />;
      },
    }),
  ]);
}
