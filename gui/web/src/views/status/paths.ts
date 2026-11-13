// Paths in the Status View: where hephaistos keeps its files, as `hephaistos status` lists them.

import type { Schemas } from "../../api/client";
import { shortPath } from "../../paths";
import { sizeText } from "../../text";

type PathJson = Schemas["PathJson"];

/** A directory: its label, its path in full and as shown, and what it holds. */
export interface PathRow {
  label: string;
  path: string;
  shown: string;
  holds: string;
}

function sized(entry: PathJson, holds: string): string {
  return entry.size === null ? holds : `${sizeText(entry.size)}, ${holds}`;
}

/** The rows of Paths, with `home` as `~`; one not there yet says so. */
export function pathRows(
  paths: Schemas["HephaistosPathsJson"],
  home: string | undefined,
): PathRow[] {
  const { code, logs, desktop } = paths;
  const logged = logs.size === null ? "the logs" : `${sizeText(logs.size)} of logs`;
  const rows: [string, PathJson, string][] = [
    ["Code", code, code.checkout ? "the checkout hephaistos runs from" : "the installed package"],
    ["Config", paths.config, "config.toml, and config.<hostname>.toml for one machine"],
    ["Data", paths.data, sized(paths.data, "the database and the server token")],
    ["Logs", logs, `${logged}, and the files of the running daemon`],
    // Not "Desktop": About names the desktop environment so.
    ["App", desktop, sized(desktop, "the browser profile of the desktop app, mostly caches")],
  ];
  return rows.map(([label, entry, holds]) => ({
    label,
    path: entry.path,
    shown: shortPath(entry.path, home),
    holds: entry.exists ? holds : `not there yet; ${holds}`,
  }));
}
