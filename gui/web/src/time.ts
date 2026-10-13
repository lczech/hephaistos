// Times as the CLI shows them.

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How long ago, e.g. `now`, `3m ago`, `2h ago`, `5d ago`; times ahead (clock skew) are `now`. */
export function ago(at: string | number, now: number): string {
  const seconds = (now - new Date(at).getTime()) / 1000;
  if (seconds < MINUTE) return "now";
  if (seconds < HOUR) return `${Math.floor(seconds / MINUTE)}m ago`;
  if (seconds < DAY) return `${Math.floor(seconds / HOUR)}h ago`;
  return `${Math.floor(seconds / DAY)}d ago`;
}

/** Seconds until a time, at least 0. */
export function secondsUntil(at: string, now: number): number {
  return Math.max(0, Math.round((new Date(at).getTime() - now) / 1000));
}

/** A number of seconds as the CLI prints it, e.g. `0.8 s`, `60 s`. */
export function seconds(value: number): string {
  return `${Number(value.toPrecision(6))} s`;
}

/** A point in time in local time, e.g. `2026-10-05 14:03:21`. */
export function fullTime(at: string): string {
  const time = new Date(at);
  const two = (value: number) => String(value).padStart(2, "0");
  const date = `${time.getFullYear()}-${two(time.getMonth() + 1)}-${two(time.getDate())}`;
  return `${date} ${two(time.getHours())}:${two(time.getMinutes())}:${two(time.getSeconds())}`;
}
