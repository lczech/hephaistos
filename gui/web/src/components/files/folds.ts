// Folds of a tree of paths: a folded directory folds all below it, however its row reads
// elsewhere (a chain joined, or each by its path). Directories' paths end in `/`.

/**
 * The folded path that folds `path`: the outermost directory above it folded, else itself if
 * folded; undefined if none is. A directory's header can read otherwise elsewhere (a chain
 * joined, or each by its path), so a fold holds for all below it.
 */
export function foldedBy(paths: ReadonlySet<string>, path: string): string | undefined {
  for (let cut = path.indexOf("/"); cut !== -1 && cut < path.length - 1; ) {
    const above = path.slice(0, cut + 1);
    if (paths.has(above)) return above;
    cut = path.indexOf("/", cut + 1);
  }
  return paths.has(path) ? path : undefined;
}

/** The paths with `path` folded, or unfolded: with whatever folded it above, so it shows. */
export function withFolded(
  paths: ReadonlySet<string>,
  path: string,
  folded: boolean,
): ReadonlySet<string> {
  return folded ? new Set([...paths, path]) : unfolding(paths, [path]);
}

/** The paths without any that folds one of `shown`: each itself, or a directory above it. */
export function unfolding(
  paths: ReadonlySet<string>,
  shown: Iterable<string>,
): ReadonlySet<string> {
  const next = new Set(paths);
  for (const path of shown) {
    for (let by = foldedBy(next, path); by !== undefined; by = foldedBy(next, path)) {
      next.delete(by);
    }
  }
  return next;
}
