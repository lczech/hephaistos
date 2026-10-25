// The settings and their sources, worded as `hephaistos config show` words them.

import type { Schemas } from "../../api/client";
import { shortPath } from "../../paths";

type Config = Schemas["ConfigJson"];
type Setting = Schemas["SettingJson"];

/** A value as written in TOML, but strings without quotes: `true`, `60.0`, `auto`. */
export function valueText(value: Setting["value"], type: Setting["type"]): string {
  // JavaScript's numbers are all floats, and print whole ones as integers: `30` for 30.0.
  if (type === "float" && Number.isInteger(value)) return `${value}.0`;
  return String(value);
}

/** Where a value comes from: a file by its name, as all are in one directory; else as it is. */
export function sourceText(source: string): string {
  return source.split("/").at(-1) ?? source;
}

/** What the Daemon does differently, until it starts again; nothing if it uses the value. */
export function appliedText({ value, applied, type }: Setting): string | undefined {
  if (applied === value) return undefined;
  return `The daemon uses ${valueText(applied, type)} until it restarts.`;
}

type Tone = "warning" | "danger" | "muted";

/** A row of the sources: where settings come from, then what is ours but unused. */
export interface SourceRow {
  source: string;
  state: string;
  tone?: Tone;
  error?: string;
}

/** The sources in the order they apply, then other hosts' files and unknown variables. */
export function sourceRows(config: Config, home: string | undefined): SourceRow[] {
  const rows: SourceRow[] = config.sources.map(({ source, kind, state, error }) => ({
    source: kind === "file" ? shortPath(source, home) : source,
    state,
    tone: state === "broken" ? "danger" : state === "not found" ? "muted" : undefined,
    error: error ?? undefined,
  }));
  for (const path of config.other_hosts) {
    rows.push({ source: shortPath(path, home), state: "other host (unused here)", tone: "muted" });
  }
  for (const { name, closest } of config.unknown_variables) {
    const state = closest === null ? "unknown" : `unknown (did you mean ${closest}?)`;
    rows.push({ source: name, state, tone: "warning" });
  }
  return rows;
}
