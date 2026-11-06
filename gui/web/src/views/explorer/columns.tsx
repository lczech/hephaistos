import {
  FileSymlink,
  FileX,
  Folder,
  FolderGit2,
  FolderLock,
  FolderOpen,
  FolderSymlink,
  type LucideIcon,
} from "lucide-react";
import { Ago } from "../../components/Ago";
import { fileKind, KIND_ICONS } from "../../components/files/kinds";
import { Path } from "../../components/files/Path";
import { Indented, NoteText, TreeChevron, TreeGuides } from "../../components/list/TreeCells";
import { listColumnHelper } from "../../components/list/table";
import { TextIcon } from "../../components/TextIcon";
import { numberText, plural, sizeParts } from "../../text";
import { letterName } from "../comparison/rows";
import styles from "./ExplorerView.module.css";
import type { Entry } from "./rows";

const column = listColumnHelper<Entry>();

type Shown = Extract<Entry, { type: "entry" }>;

/** What a row's icon and tooltip say of it, beyond its name. */
export interface Looks {
  open: (row: Shown) => boolean;
  checkout: (path: string) => boolean; // a registered Checkout's top
  denied: (path: string) => boolean; // a folder this user may not list
  ahead: (row: Shown) => void; // asks for what a folder holds before it is opened
}

/** An entry's icon: a folder's open or not, a Checkout's, a symlink's, else its kind's. */
function iconOf(row: Shown, looks: Looks): LucideIcon {
  const { entry } = row;
  if (entry.kind === "symlink") {
    if (entry.to === null) return FileX;
    return entry.to === "directory" ? FolderSymlink : FileSymlink;
  }
  if (entry.kind !== "directory") return KIND_ICONS[fileKind(entry.name)];
  if (looks.denied(row.path)) return FolderLock;
  if (looks.checkout(row.path)) return FolderGit2;
  return looks.open(row) ? FolderOpen : Folder;
}

function titleOf(row: Shown): string {
  const { entry } = row;
  if (entry.kind !== "symlink") return row.path;
  return `${row.path}\n${entry.to === null ? "broken: points to" : "points to"} ${entry.target}`;
}

/** The fields a listing may give besides names and kinds, as the API names them. */
export const FIELDS = ["git", "size", "modified"] as const;

/** The columns whose values cost to ask for, so hidden until shown: asked for only then. */
export const COSTLY = [
  { id: "size", meta: { hiddenAtFirst: true } },
  { id: "modified", meta: { hiddenAtFirst: true } },
];

/** How git's letter colours an entry, as Changes colours its kinds of change. */
function gitTone(row: Shown): "added" | "modified" | "conflict" | undefined {
  const { status, changed } = row.entry;
  if (status === "A" || status === "?") return "added";
  if (status === "U" || status === "D") return "conflict";
  if (status !== null || changed) return "modified";
  return undefined;
}

/** What git says of an entry, in words: `staged: added; not staged: modified`. */
function gitTitle(row: Shown): string {
  const { status, index, worktree, changed } = row.entry;
  if (status === "?") return "untracked";
  if (status === "U") return "unmerged";
  const parts = [
    ...(index ? [`staged: ${letterName(index)}`] : []),
    ...(worktree ? [`not staged: ${letterName(worktree)}`] : []),
  ];
  return parts.length > 0 ? parts.join("; ") : changed ? "changes below it" : "";
}

/**
 * An entry's name after its icon, coloured by git's letter, or for changes below a folder; hidden
 * ones quieter, in italics; ignored ones quieter; broken symlinks marked.
 */
function NameCell({ row, looks }: { row: Shown; looks: Looks }) {
  const broken = row.entry.kind === "symlink" && row.entry.to === null;
  const name = (
    <Path
      whole
      shown={row.shown}
      title={titleOf(row)}
      icon={
        <span className={broken ? styles.broken : styles.icon}>
          <TextIcon icon={iconOf(row, looks)} />
        </span>
      }
    />
  );
  // Pointing at a closed folder asks for what it holds, so that opening it shows that at once.
  const ahead = row.folder && !looks.open(row) ? () => looks.ahead(row) : undefined;
  return (
    <span
      className={styles.name}
      data-hidden={row.entry.hidden || undefined}
      data-ignored={row.entry.ignored || undefined}
      data-git={gitTone(row)}
      onPointerEnter={ahead}
    >
      {name}
    </span>
  );
}

/**
 * An entry's size: a file's amount, then its unit; a folder's number of entries, then `items`;
 * either in a box as wide as the widest, so that all numbers line up at their end.
 */
function SizeCell({ entry }: { entry: Shown["entry"] }) {
  if (entry.items !== null) {
    return (
      <>
        {numberText(entry.items)} <span className={styles.unit}>{plural(entry.items, "item")}</span>
      </>
    );
  }
  if (entry.size === null) return "";
  const [amount, unit] = sizeParts(entry.size);
  return (
    <>
      {amount} <span className={styles.unit}>{unit}</span>
    </>
  );
}

/** git's letter for an entry, in its colour, or a dot for changes below a folder. */
function GitCell({ row }: { row: Shown }) {
  const { status, changed, ignored } = row.entry;
  if (ignored) return "";
  const letter = status ?? (changed ? "•" : "");
  return (
    <span className={styles.git} data-git={gitTone(row)} title={gitTitle(row)}>
      {letter}
    </span>
  );
}

/**
 * The Explorer's columns: a folder's chevron, in line with its name; the name; git's letter;
 * then the size and the time last modified, hidden until shown. All but the letter sort.
 */
export function explorerColumns(looks: Looks) {
  return column.columns([
    column.display({
      id: "square",
      cell: ({ row }) => (
        <>
          <TreeGuides depth={row.depth} />
          {row.original.type === "entry" && row.original.folder && (
            <TreeChevron depth={row.depth} />
          )}
        </>
      ),
      enableResizing: false,
      meta: { width: "var(--square)" },
    }),
    column.accessor((entry) => (entry.type === "entry" ? entry.shown : ""), {
      id: "name",
      header: "name",
      enableSorting: true,
      size: 360,
      meta: { identifies: true },
      cell: ({ row }) => {
        const entry = row.original;
        return (
          <Indented depth={row.depth}>
            {entry.type === "note" ? (
              <NoteText note={entry} />
            ) : (
              <NameCell row={entry} looks={looks} />
            )}
          </Indented>
        );
      },
    }),
    column.display({
      id: "git",
      header: "git",
      enableResizing: false,
      meta: {
        width: "max-content",
        align: "center",
        description: "git's status: its letter, or • for changes below",
      },
      cell: ({ row }) => (row.original.type === "entry" ? <GitCell row={row.original} /> : ""),
    }),
    column.accessor(
      (entry) =>
        entry.type === "entry" ? (entry.entry.size ?? entry.entry.items ?? undefined) : undefined,
      {
        id: "size",
        header: "size",
        enableSorting: true,
        sortDescFirst: true,
        size: 80,
        meta: { align: "right", figures: true, ...COSTLY[0]?.meta },
        cell: ({ row }) =>
          row.original.type === "entry" ? <SizeCell entry={row.original.entry} /> : "",
      },
    ),
    column.accessor(
      (entry) => (entry.type === "entry" ? (entry.entry.modified ?? undefined) : undefined),
      {
        id: "modified",
        header: "modified",
        enableSorting: true,
        sortDescFirst: true,
        size: 90,
        meta: { align: "right", figures: true, ...COSTLY[1]?.meta },
        cell: ({ row, table }) => {
          const entry = row.original;
          return entry.type === "entry" ? (
            <Ago at={entry.entry.modified} now={table.options.meta?.now} />
          ) : (
            ""
          );
        },
      },
    ),
  ]);
}
