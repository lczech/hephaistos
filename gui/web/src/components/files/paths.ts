// Trees of paths: the directories that flat paths lie in, as a tree's rows show them. A
// directory's path ends in `/`, as a folder's does.

import { pathParts } from "../../paths";

/** A directory below another, with all items below it. */
export interface Directory<T> {
  path: string;
  items: T[];
}

/**
 * The directory an item's path below `base` shows in: by its path, its own folder; or nested,
 * the next one below `base`, else `base` itself.
 */
function directoryOf(path: string, base: string, nested: boolean): string {
  if (!nested) return pathParts(path)[0];
  const rest = path.slice(base.length);
  const cut = rest.indexOf("/") + 1;
  return cut === 0 || cut === rest.length ? base : base + rest.slice(0, cut);
}

/**
 * The items below `base`, by where they show: in a directory each, with all below it, and
 * those directly in `base`. Directories show each by its path or, nested, only those directly
 * below `base`, one holding a single directory and nothing else joined with it:
 * `src/hephaistos/`.
 */
export function directoriesBelow<T>(
  items: T[],
  pathOf: (item: T) => string,
  base: string,
  nested: boolean,
): { directories: Directory<T>[]; direct: T[] } {
  const byDirectory = new Map<string, T[]>();
  for (const item of items) {
    const directory = directoryOf(pathOf(item), base, nested);
    const within = byDirectory.get(directory);
    if (within) within.push(item);
    else byDirectory.set(directory, [item]);
  }
  const directories = [...byDirectory]
    .filter(([path]) => path !== base)
    .map(([path, items]) => ({ path: nested ? joined(path, items, pathOf) : path, items }));
  return { directories, direct: byDirectory.get(base) ?? [] };
}

/** A directory joined with those below it while it holds just one: `src/` → `src/hephaistos/`. */
function joined<T>(path: string, items: T[], pathOf: (item: T) => string): string {
  const [first, ...others] = items.map((item) => directoryOf(pathOf(item), path, true));
  if (first === undefined || first === path || others.some((other) => other !== first)) {
    return path;
  }
  return joined(first, items, pathOf);
}
