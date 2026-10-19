import {
  FileDiff,
  FileDigit,
  FileMinus,
  FilePen,
  FilePlus,
  FileWarning,
  Folder,
  FolderPlus,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Chevron } from "../../components/table/ListTable";
import { listColumnHelper } from "../../components/table/list";
import styles from "./ChangesView.module.css";
import {
  type Change,
  changedLines,
  type Entry,
  groupName,
  type Kind,
  kindCounts,
  kindOf,
  otherText,
  pathParts,
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
      <Icon aria-hidden="true" />
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
  const shares = {
    "--added": most ? added / most : 0,
    "--removed": most ? removed / most : 0,
  } as CSSProperties;
  return <span className={styles.meter} style={shares} aria-hidden="true" />;
}

/** A file's lines added and removed, if counted. */
function counted(entry: Entry): { added: number; removed: number } | undefined {
  if (entry.type !== "change") return undefined;
  const { added, removed } = entry.change;
  return added === null || removed === null ? undefined : { added, removed };
}

/**
 * A path after its icon, its folder quieter. Cut off where narrow: a file's at its end, a
 * folder's at its start, so that its last part, the one it is, stays.
 */
function Path({ shown, title, icon }: { shown: string; title: string; icon: ReactNode }) {
  const [folder, name] = pathParts(shown);
  return (
    <span className={styles.named}>
      {icon}
      <span className={styles.path} title={title} data-from-start={name.endsWith("/") || undefined}>
        <bdi>
          <span className={styles.folder}>{folder}</span>
          {name}
        </bdi>
      </span>
    </span>
  );
}

/** A change's row: its path below what the rows around it say, after what happened to it. */
export function ChangePath({ change, base }: { change: Change; base: string }) {
  const renamed = change.original === null ? "" : `\nrenamed from ${change.original}`;
  return (
    <span data-deleted={change.status === "D" || undefined}>
      <Path
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
    </span>
  );
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
 * bars, as long as their share of `most`. Rows that `fold` have a chevron.
 */
export function changesColumns(most: number, folds: (entry: Entry) => boolean) {
  return column.columns([
    column.display({
      id: "square",
      cell: ({ row }) => (folds(row.original) ? <Chevron /> : ""),
      enableResizing: false,
      meta: { width: "var(--square)" },
    }),
    column.accessor((entry) => (entry.type === "change" ? entry.change.path : ""), {
      id: "path",
      header: "path",
      enableSorting: true,
      enableResizing: false,
      meta: { width: "minmax(10rem, 1fr)" },
      cell: ({ row }) => {
        const entry = row.original;
        switch (entry.type) {
          case "note":
            return <span className={styles.note}>{entry.text}</span>;
          case "group":
            return <GroupName entry={entry} />;
          case "directory":
            return (
              <Path
                shown={entry.path}
                title={entry.path}
                icon={
                  <span className={styles.kind}>
                    <Folder aria-hidden="true" />
                  </span>
                }
              />
            );
          default:
            return <ChangePath change={entry.change} base={entry.base} />;
        }
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
          const sum = totals(entry.type === "group" ? entry.group.changes : entry.changes);
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
      meta: { width: "calc(3rem + var(--space-3))" },
      cell: ({ row }) => {
        const lines = counted(row.original);
        return lines && <Meter {...lines} most={most} />;
      },
    }),
  ]);
}
