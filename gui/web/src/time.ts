// Times as the CLI shows them.

const two = (value: number) => String(value).padStart(2, "0");

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY; // as far as `recent` stays relative
const YEAR = 365 * DAY;

/**
 * How long ago: `now`, `3m ago`, `2h ago`, `5d ago`, `4mo ago`, `6y ago`; times ahead (clock
 * skew) are `now`.
 */
export function ago(at: string | number, now: number): string {
  const seconds = (now - new Date(at).getTime()) / 1000;
  if (seconds < MINUTE) return "now";
  if (seconds < HOUR) return `${Math.floor(seconds / MINUTE)}m ago`;
  if (seconds < DAY) return `${Math.floor(seconds / HOUR)}h ago`;
  if (seconds < MONTH) return `${Math.floor(seconds / DAY)}d ago`;
  const months = Math.floor(seconds / MONTH);
  if (months < 12) return `${months}mo ago`;
  return `${Math.max(1, Math.floor(seconds / YEAR))}y ago`; // from 360 days, 12 months of 30
}

/** In local time, as `ls` shows it: `14:03` today, `10-05 14:03` this year, else `2025-10-05`. */
export function shortTime(at: string | number, now: number): string {
  const [time, today] = [new Date(at), new Date(now)];
  const clock = `${two(time.getHours())}:${two(time.getMinutes())}`;
  const day = `${two(time.getMonth() + 1)}-${two(time.getDate())}`;
  if (time.getFullYear() !== today.getFullYear()) return `${time.getFullYear()}-${day}`;
  return time.toDateString() === today.toDateString() ? clock : `${day} ${clock}`;
}

/** How times are shown, as the setting `time_format` says, in the CLI too. */
export type TimeFormat = "auto" | "relative" | "recent" | "short" | "full";

/**
 * A time as `format` says: relative, `5d ago`; short; full; or, `recent` and `auto`, relative
 * for the last 30 days, then the day, which says more then: `2026-09-05`.
 */
export function timeText(at: string | number, now: number, format: TimeFormat): string {
  if (format === "relative") return ago(at, now);
  if (format === "short") return shortTime(at, now);
  if (format === "full") return fullTime(at);
  return now - new Date(at).getTime() < MONTH * 1000 ? ago(at, now) : fullTime(at).slice(0, 10);
}

/** Whole seconds until a time, rounded up so that only a time reached is 0. */
export function secondsUntil(at: string | number, now: number): number {
  return Math.max(0, Math.ceil((new Date(at).getTime() - now) / 1000));
}

/** A number of seconds as the CLI prints it, e.g. `0.8 s`, `60 s`. */
export function seconds(value: number): string {
  return `${Number(value.toPrecision(6))} s`;
}

/** A point in time in local time, e.g. `2026-10-05 14:03:21`. */
export function fullTime(at: string | number): string {
  const time = new Date(at);
  const date = `${time.getFullYear()}-${two(time.getMonth() + 1)}-${two(time.getDate())}`;
  return `${date} ${two(time.getHours())}:${two(time.getMinutes())}:${two(time.getSeconds())}`;
}

/** A point in time in local time to the millisecond, e.g. `2026-10-05 14:03:21.123`. */
export function preciseTime(at: string | number): string {
  return `${fullTime(at)}.${String(new Date(at).getMilliseconds()).padStart(3, "0")}`;
}

/** A point in time and how long ago, as details show it: `2026-10-05 14:03:21 (3m ago)`; to the
 * millisecond if `precise`. */
export function timeAndAgo(at: string | number, now: number, precise = false): string {
  return `${precise ? preciseTime(at) : fullTime(at)} (${ago(at, now)})`;
}
