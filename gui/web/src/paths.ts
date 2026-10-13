/** A path as the CLI shows it: under the home directory as `~/…`. */
export function shortPath(path: string, home: string | undefined): string {
  if (!home || home === "/") return path;
  if (path === home) return "~";
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}
