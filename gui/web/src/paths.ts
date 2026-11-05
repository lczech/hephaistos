/** A path as the CLI shows it: under the home directory as `~/…`. */
export function shortPath(path: string, home: string | undefined): string {
  if (!home || home === "/") return path;
  if (path === home) return "~";
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/** A path's folder, with its `/`, and its name: `src/`, `main.py`; a folder's own name ends in `/`. */
export function pathParts(path: string): [string, string] {
  const cut = path.lastIndexOf("/", path.length - 2) + 1;
  return [path.slice(0, cut), path.slice(cut)];
}
