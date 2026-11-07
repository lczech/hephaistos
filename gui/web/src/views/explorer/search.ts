// Finding files and folders by name below the Directory shown: the Server lists every path
// below it once (`/api/files/paths`), a folder's ending in `/`; the find row's worker matches
// them as typed, names, or paths below the Directory where what is typed has a `/`. The tree
// then shows the first matches, in the folders holding them.

import { useState } from "react";
import type { Schemas } from "../../api/client";
import type { Match } from "../../components/find/pattern";
import { atLeast, numberText } from "../../text";
import { below, type Entry, type FileEntry, type Search } from "./rows";

export const MAX_SHOWN = 1_000; // matches shown at most; no one steps through more

/** A path below the Directory without a folder's final `/`: `src/`, `src`. */
export const bare = (path: string) => path.replace(/\/$/, "");

/** What each path is matched by: its name, or, with `byPath`, all of it. */
export function searchLines(paths: readonly string[], byPath: boolean): string[] {
  return paths.map((path) => (byPath ? bare(path) : (bare(path).split("/").at(-1) ?? "")));
}

/**
 * The lines the paths are matched by, held while the paths and how they are matched stay, as
 * the find matches again once its lines are others: so typing alone matches anew.
 */
export function useSearchLines(
  paths: readonly string[] | undefined,
  byPath: boolean,
): readonly string[] | undefined {
  const [held, setHeld] = useState<{
    paths: readonly string[];
    byPath: boolean;
    lines: string[];
  }>();
  if (paths === undefined) return undefined;
  if (held?.paths === paths && held.byPath === byPath) return held.lines;
  const lines = searchLines(paths, byPath);
  setHeld({ paths, byPath, lines });
  return lines;
}

/** Where a name's matches are in it: from, to. */
export type Marks = [number, number][];

/** What a search found: the first paths matched, how many in all, their matches. */
export interface Found {
  paths: string[]; // in the order listed, by name; at most MAX_SHOWN
  total: number; // paths matched, as far as matches were counted
  more: boolean; // the matches counted stopped: there may be more paths
  marks: Map<string, Marks>; // in their names, by their paths without a final `/`
}

/**
 * The paths the matches in their lines (`searchLines`) are in, and where in their names: a
 * match in a path, `byPath`, only as far as it is in the name.
 */
export function foundPaths(
  paths: readonly string[],
  matches: readonly Match[],
  { more, byPath }: { more: boolean; byPath: boolean },
): Found {
  const shown: string[] = [];
  const marks = new Map<string, Marks>();
  let total = 0;
  let last = -1;
  for (const { line, start, end } of matches) {
    const path = paths[line];
    if (path === undefined) continue;
    if (line !== last) {
      total++;
      last = line;
      if (shown.length < MAX_SHOWN) shown.push(path);
    }
    if (shown.at(-1) !== path) continue;
    const key = bare(path);
    const from = byPath ? key.length - (key.split("/").at(-1) ?? "").length : 0;
    if (end <= from) continue; // in the folders holding it, which show it themselves
    marks.set(key, [...(marks.get(key) ?? []), [Math.max(start - from, 0), end - from]]);
  }
  return { paths: shown, total, more, marks };
}

/** The folders holding a path, by their IDs: `a/b/c` is in `a/` and `a/b/`. */
export function foldersOf(path: string): string[] {
  const parts = bare(path).split("/").slice(0, -1);
  return parts.map((_, at) => `${parts.slice(0, at + 1).join("/")}/`);
}

/** What the tree shows of the paths found: them and the folders holding them. */
export function searchOf(paths: readonly string[]): Search & { folders: Set<string> } {
  const folders = new Set(paths.flatMap(foldersOf));
  return {
    shown: new Set([...paths, ...folders].map(bare)),
    within: new Set(["", ...folders]),
    folders,
  };
}

/** An entry as a path names it, until its folder's listing tells more: a folder, else a file. */
function entryOf(path: string): FileEntry {
  const name = bare(path).split("/").at(-1) ?? "";
  return {
    name,
    kind: path.endsWith("/") ? "directory" : "file",
    hidden: name.startsWith("."),
    target: null,
    to: null,
    size: null,
    items: null,
    modified: null,
    status: null,
    index: null,
    worktree: null,
    ignored: null,
    changed: null,
  };
}

/**
 * What the folders holding the paths found hold of them, by their paths, as listings would give
 * it: to show them at once, before their listings come.
 */
export function listedOf(
  root: string,
  paths: readonly string[],
  folders: ReadonlySet<string>,
): Map<string, { items: FileEntry[]; count: number }> {
  const listed = new Map<string, { items: FileEntry[]; count: number }>();
  for (const path of new Set([...folders, ...paths])) {
    const parent = foldersOf(path).at(-1) ?? "";
    const at = parent === "" ? root : below(root, parent);
    const found = listed.get(at) ?? { items: [], count: 0 };
    found.items.push(entryOf(path));
    found.count++;
    listed.set(at, found);
  }
  return listed;
}

/** The paths found, as their rows come in the tree, its folders all open: to step through. */
export function inTreeOrder(rows: readonly Entry[], found: ReadonlySet<string>): string[] {
  return rows.flatMap((row) =>
    row.type === "entry"
      ? [...(found.has(bare(row.id)) ? [bare(row.id)] : []), ...inTreeOrder(row.subRows, found)]
      : [],
  );
}

/** What the find row says after which match: why there may be more than shown, if so. */
export function searchNote(
  found: Found | undefined,
  listed: Schemas["PathsJson"] | undefined,
): { text: string; title: string } | undefined {
  const notes: { text: string; title: string }[] = [];
  if (found && found.total > MAX_SHOWN) {
    notes.push({
      text: `first ${numberText(MAX_SHOWN)} shown`,
      title: `${atLeast(found.total, found.more)} found; the first ${numberText(MAX_SHOWN)} show: find more narrowly`,
    });
  }
  if (listed?.stopped === "time") {
    notes.push({
      text: `stopped after ${listed.limit ?? 0} s`,
      title: `Listing stopped after ${listed.limit ?? 0} s, as the setting files.search_seconds allows: find in a folder further in`,
    });
  } else if (listed?.stopped === "max_paths") {
    notes.push({
      text: `stopped at ${numberText(listed.limit ?? 0)} paths`,
      title: `Listing stopped at ${numberText(listed.limit ?? 0)} paths, as the setting files.max_paths allows: find in a folder further in`,
    });
  }
  if (notes.length === 0) return undefined;
  return {
    text: notes.map(({ text }) => text).join("; "),
    title: notes.map(({ title }) => title).join("\n"),
  };
}
