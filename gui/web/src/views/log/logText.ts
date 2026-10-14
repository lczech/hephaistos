// A log record's parts as `hephaistos log show` prints them.

import type { Schemas } from "../../api/client";
import type { Tone } from "../../components/table/ListTable";

export type LogEntry = Schemas["LogEntryJson"];
type LogRecord = LogEntry["record"];

// Fields every record has, shown in fixed places; the rest follow as `key=value`.
const FIXED = new Set(["at", "level", "process", "pid", "logger", "message", "error", "stack"]);

const TONES: Record<string, Tone> = {
  debug: "muted",
  warning: "warning",
  error: "danger",
  critical: "alarm",
};

/** `info`, `warning`, … */
export function levelName(record: LogRecord): string {
  return String(record.level).toLowerCase();
}

export function levelTone(record: LogRecord): Tone | undefined {
  return TONES[levelName(record)];
}

/** Which process wrote it: `daemon[4242]`. */
export function processText(record: LogRecord): string {
  return `${String(record.process ?? "?")}[${String(record.pid ?? "?")}]`;
}

/** Strings as they are, anything else as JSON. */
function fieldText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** The fields passed with the message: labels and their texts. */
export function extraFields(record: LogRecord): [string, string][] {
  return Object.entries(record)
    .filter(([key]) => !FIXED.has(key))
    .map(([key, value]) => [key, fieldText(value)]);
}

/** The traceback's last line, saying what went wrong, as `log show --brief` shows it. */
export function tracebackEnd(record: LogRecord): string | undefined {
  const traceback = record.error ?? record.stack;
  if (traceback === undefined) return undefined;
  return String(traceback).trimEnd().split("\n").at(-1);
}
