// The Explorer's rows: a Directory's entries, folders first, those opened holding theirs, each
// asked for once opened. A folder holding just one folder and nothing else shows joined with
// it, opened through: `src/hephaistos/`. Rows are named by their paths below the Directory shown,
// a folder's ending in `/`, so that what is opened is kept by them.

import type { SortingState } from "@tanstack/react-table";
import type { Schemas } from "../../api/client";
import {
  inOrder,
  type Loaded,
  loadedRows,
  type Note,
  type Order,
} from "../../components/list/tree";

export type Listing = Schemas["FilesJson"];
export type FileEntry = Schemas["FileEntryJson"];

/**
 * A row: an entry, by its `id`, its path below the Directory shown; `path`, where it is; `shown`,
 * its name, or a chain of folders joined; and, opened, what is in the last of them.
 */
export type Entry =
  | {
      type: "entry";
      id: string;
      path: string;
      shown: string;
      entry: FileEntry;
      folder: boolean;
      subRows: Entry[];
    }
  | Note;

// The order, as the fragment's `sort`: by name unless chosen otherwise.
export const DEFAULT_SORT = "name";
export const SORTS = ["name"];

/** Names as people sort them, as VS Code does: case ignored, numbers by their value. */
const NAMES = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const ORDER: Order<FileEntry> = {
  rank: (entry) => (opens(entry) ? 0 : 1), // folders first
  values: { name: (entry) => entry.name },
  fallback: "name",
  collator: NAMES,
};

/** Whether an entry holds others: a folder, or a symlink to one. */
export function opens(entry: FileEntry): boolean {
  return entry.kind === "directory" || (entry.kind === "symlink" && entry.to === "directory");
}

/** A path below another: `/home/me` and `src/` → `/home/me/src`. */
export function below(path: string, relative: string): string {
  const base = path.endsWith("/") ? path : `${path}/`;
  return `${base}${relative}`.replace(/\/$/, "") || "/";
}

/** How rows are made: what each folder holds, as asked for; which are open; what shows. */
export interface Making {
  loaded: (path: string) => Loaded<FileEntry>;
  opened: ReadonlySet<string>;
  hidden: boolean; // entries whose names start with `.` show too
  sorted: SortingState;
}

function shownOf(items: FileEntry[], making: Making): FileEntry[] {
  return making.hidden ? items : items.filter((item) => !item.hidden);
}

/** The folder a row opened shows the entries of: through those holding a single folder. */
function joined(path: string, shown: string, making: Making): [string, string] {
  const loaded = making.loaded(path);
  if (loaded === undefined || "error" in loaded) return [path, shown];
  const items = shownOf(loaded.items, making);
  const [only] = items;
  if (items.length !== 1 || loaded.count !== loaded.items.length || !only || !opens(only)) {
    return [path, shown];
  }
  return joined(below(path, only.name), `${shown}/${only.name}`, making);
}

/** The rows of a folder's entries, below `prefix`: those of folders opened holding theirs. */
export function entryRows(
  path: string,
  prefix: string,
  items: FileEntry[],
  making: Making,
): Entry[] {
  return inOrder(shownOf(items, making), making.sorted, ORDER).map((entry): Entry => {
    const folder = opens(entry);
    const id = `${prefix}${entry.name}${folder ? "/" : ""}`;
    const at = below(path, entry.name);
    if (!folder || !making.opened.has(id)) {
      return { type: "entry", id, path: at, shown: entry.name, entry, folder, subRows: [] };
    }
    const [last, shown] = joined(at, entry.name, making);
    const inside = `${prefix}${shown}/`;
    return {
      type: "entry",
      id,
      path: last,
      shown,
      entry,
      folder,
      subRows: loadedRows(
        id,
        making.loaded(last),
        (found) => entryRows(last, inside, found, making),
        {
          more: moreText,
        },
      ),
    };
  });
}

/** That a folder lists only the first entries, as the setting allows. */
export function moreText(more: number, listed: number): string {
  return `${more.toLocaleString("en")} more not listed, as the setting files.max_entries allows ${listed.toLocaleString("en")}`;
}

/** The Directory's rows: its entries, or that they are asked for, or why they cannot be. */
export function rows(root: string, making: Making): Entry[] {
  return loadedRows("", making.loaded(root), (items) => entryRows(root, "", items, making), {
    more: moreText,
  });
}

/** The folders a tree's rows ask for, in their order: the Directory, and those opened in it. */
export function asked(
  root: string,
  making: Omit<Making, "loaded">,
  loaded: Making["loaded"],
): string[] {
  const paths: string[] = [];
  const recording = (path: string) => {
    if (!paths.includes(path)) paths.push(path);
    return loaded(path);
  };
  rows(root, { ...making, loaded: recording });
  return paths;
}

/** The rows that hold rows, by their IDs: folders, opened or not. */
export function folders(rows: Entry[]): Map<string, Extract<Entry, { type: "entry" }>> {
  const found = new Map<string, Extract<Entry, { type: "entry" }>>();
  for (const row of rows) {
    if (row.type !== "entry" || !row.folder) continue;
    found.set(row.id, row);
    for (const [id, inner] of folders(row.subRows)) found.set(id, inner);
  }
  return found;
}
