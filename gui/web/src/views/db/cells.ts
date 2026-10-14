// Values of the database as `hephaistos db dump` shows them, by their column's type.

import type { Schemas } from "../../api/client";
import { preciseTime } from "../../time";

export type ValueType = Schemas["ColumnJson"]["type"];

const CLOCK = /^(.+) #(\d+)$/; // `2026-10-14T20:27:20.096+00:00 #3`

/** A time as JSON has it, in local time; anything else as it is. */
function timeText(value: string): string {
  return Number.isNaN(Date.parse(value)) ? value : preciseTime(value);
}

/**
 * A value as one line: clock values and times in local time, JSON compact, the rest as it is;
 * `null` for NULL, which shows apart.
 */
export function cellText(value: unknown, type: ValueType): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const clock = type === "clock" ? CLOCK.exec(value) : null;
    if (clock?.[1] !== undefined) return `${timeText(clock[1])} #${clock[2]}`;
    if (type === "time") return timeText(value);
  }
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
