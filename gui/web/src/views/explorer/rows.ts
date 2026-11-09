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
 * A row: an entry, by its `id`, its path below the Directory shown; `path`, where it is, in the
 * folder `parent`, whose listing has it; `shown`,
 * its name, or a chain of folders joined; and, opened, what is in the last of them.
 */
export type Entry =
  | {
      type: "entry";
      id: string;
      path: string;
      parent: string;
      shown: string;
      entry: FileEntry;
      folder: boolean;
      empty: boolean; // a folder known to show nothing: nothing to open, as VS Code has it
      subRows: Entry[];
    }
  | Note;

// The order, as the fragment's `sort`: by name unless chosen otherwise.
export const DEFAULT_SORT = "name";
export const SORTS = ["name", "size", "modified"];

/** Names as people sort them, as VS Code does: case ignored, numbers by their value. */
const NAMES = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const ORDER: Order<FileEntry> = {
  rank: (entry) => (opens(entry) ? 0 : 1), // folders first
  values: {
    name: (entry) => entry.name,
    size: (entry) => entry.size ?? entry.items ?? undefined, // a folder's: its entries
    modified: (entry) => entry.modified ?? undefined, // ISO 8601, so in order as text
  },
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

/**
 * What a search shows: the entries matched and the folders holding them, by their paths below
 * the Directory without a final `/` (`shown`); in the folders holding them, by their IDs, `""`
 * for the Directory (`within`), only those.
 */
export interface Search {
  shown: ReadonlySet<string>;
  within: ReadonlySet<string>;
}

/** How rows are made: what each folder holds, as asked for; which are open; what shows. */
export interface Making {
  loaded: (path: string) => Loaded<FileEntry>;
  opened: ReadonlySet<string>;
  hidden: boolean; // entries whose names start with `.` show too
  sorted: SortingState;
  search?: Search; // only what it found, folders not joined
  apart?: (path: string) => boolean; // folders never joined through, e.g. Checkouts' tops
  known?: (path: string) => Loaded<FileEntry>; // also ahead of time, not asking: else `loaded`
}

/**
 * Whether a folder shows nothing, as far as known without asking: it has no entries, or none
 * shown, e.g. only hidden ones, and none left unlisted.
 */
function showsNothing(entry: FileEntry, path: string, id: string, making: Making): boolean {
  if (entry.items === 0) return true;
  const known = (making.known ?? making.loaded)(path);
  if (known === undefined || "error" in known || known.count !== known.items.length) return false;
  return shownOf(known.items, id, making).length === 0;
}

/** The entries in the folder whose rows are below `prefix` that show. */
function shownOf(items: FileEntry[], prefix: string, making: Making): FileEntry[] {
  const { search } = making;
  return items.filter(
    (item) =>
      (making.hidden || !item.hidden) &&
      (!search?.within.has(prefix) || search.shown.has(`${prefix}${item.name}`)),
  );
}

/**
 * The folder a row opened shows the entries of: through those holding a single folder; not while
 * searching, as each folder may be a match, nor through one kept `apart`, as a Checkout's top,
 * whose row says what it is, nor through a symlink, which may lead back to a folder above it.
 */
function joined(path: string, shown: string, making: Making): [string, string] {
  const loaded = making.loaded(path);
  if (making.search || making.apart?.(path) || loaded === undefined || "error" in loaded) {
    return [path, shown];
  }
  const items = shownOf(loaded.items, "", making);
  const [only] = items;
  if (items.length !== 1 || loaded.count !== loaded.items.length || only?.kind !== "directory") {
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
  return inOrder(shownOf(items, prefix, making), making.sorted, ORDER).map((entry): Entry => {
    const folder = opens(entry);
    const id = `${prefix}${entry.name}${folder ? "/" : ""}`;
    const at = below(path, entry.name);
    const empty = folder && showsNothing(entry, at, id, making);
    // Open, it is still asked for, so that it tells once it holds something.
    if (empty && making.opened.has(id)) making.loaded(at);
    if (!folder || empty || !making.opened.has(id)) {
      return {
        type: "entry",
        id,
        path: at,
        parent: path,
        shown: entry.name,
        entry,
        folder,
        empty,
        subRows: [],
      };
    }
    const [last, shown] = joined(at, entry.name, making);
    const inside = `${prefix}${shown}/`;
    return {
      type: "entry",
      id,
      path: last,
      parent: path,
      shown,
      entry,
      folder,
      empty,
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

/**
 * The paths below the Directory a row shows, without a final `/`: its own, or each of a chain
 * of folders joined, `src`, `src/app`.
 */
export function shownPaths(row: Extract<Entry, { type: "entry" }>): string[] {
  const start = row.id.replace(/\/$/, "").slice(0, -row.entry.name.length); // its folder's
  const parts = row.shown.split("/");
  return parts.map((_, at) => `${start}${parts.slice(0, at + 1).join("/")}`);
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
  rows(root, { ...making, loaded: recording, known: making.known ?? loaded });
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
