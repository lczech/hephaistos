import { createContext, use } from "react";
import { fullTime, type TimeFormat, timeText } from "../time";

const FORMATS: readonly string[] = ["auto", "relative", "recent", "short", "full"];

/** How times are shown, as the setting `time_format` says (`App.tsx`); `auto` until known. */
export const TimeFormatContext = createContext<TimeFormat>("auto");

/** The format a setting's value names, else `auto`. */
export function timeFormatOf(value: unknown): TimeFormat {
  return typeof value === "string" && FORMATS.includes(value) ? (value as TimeFormat) : "auto";
}

/**
 * A time as the setting `time_format` says, `5m ago` for the last 30 days, then `2026-09-05`,
 * unless set otherwise; in full when hovered; nothing if unknown.
 */
export function Ago({ at, now }: { at: string | null; now: number | undefined }) {
  const format = use(TimeFormatContext);
  if (at === null) return "";
  return <span title={fullTime(at)}>{timeText(at, now ?? Date.now(), format)}</span>;
}
