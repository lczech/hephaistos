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
import { fileKind, KIND_ICONS } from "../../components/files/kinds";
import { Path } from "../../components/files/Path";
import { Indented, NoteText, TreeChevron, TreeGuides } from "../../components/list/TreeCells";
import { listColumnHelper } from "../../components/list/table";
import { TextIcon } from "../../components/TextIcon";
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

/** An entry's name after its icon; hidden ones quieter, in italics; broken symlinks marked. */
function NameCell({ row, looks }: { row: Shown; looks: Looks }) {
  const broken = row.entry.kind === "symlink" && row.entry.to === null;
  const name = (
    <Path
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
    <span className={row.entry.hidden ? styles.hidden : undefined} onPointerEnter={ahead}>
      {name}
    </span>
  );
}

/** The Explorer's columns: a folder's chevron, in line with its name; the name, sorting. */
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
  ]);
}
