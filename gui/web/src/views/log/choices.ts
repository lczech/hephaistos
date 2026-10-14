// What the Log list's filters offer, and what the filters set say in the tab's title.

import type { ColumnFiltersState } from "@tanstack/react-table";
import type { LogFilters } from "../../api/queries";
import type { Choice } from "../../components/table/filters";
import { type Params, paramValues, withParam } from "../address";
import { columnFilters, filteredParams, filteredTitle, SINCE } from "../filters";
import { columns } from "./columns";

const one = (params: Params, name: string) => paramValues(params[name])[0];

/** The filters in these parameters, as `/api/log` takes them. */
export function logFilters(params: Params): LogFilters {
  const pid = one(params, "pid");
  return {
    level: one(params, "level") as LogFilters["level"], // the Server refuses any other
    process: one(params, "process") as LogFilters["process"],
    pid: pid === undefined ? undefined : Number(pid),
    since: one(params, "since"),
  };
}

// The process column's filter with a pid set: that one process, as `daemon[4242]`.
const ONE_PROCESS = /^(.+)\[(\d+)\]$/;

function oneProcess(params: Params): string | undefined {
  const pid = one(params, "pid");
  return pid === undefined ? undefined : `${one(params, "process") ?? "?"}[${pid}]`;
}

/** The filters these parameters set; a pid, in the process column's. */
export function logColumnFilters(params: Params): ColumnFiltersState {
  const process = oneProcess(params);
  return columnFilters(columns, process === undefined ? params : { ...params, process });
}

/** The parameters with only these filters set: one process as its kind and pid. */
export function logParams(params: Params, filters: ColumnFiltersState): Params {
  const changed = filteredParams(columns, params, filters);
  const [, process, pid] = ONE_PROCESS.exec(one(changed, "process") ?? "") ?? [];
  if (process === undefined || pid === undefined) return withParam(changed, "pid", []);
  return withParam(withParam(changed, "process", process === "?" ? [] : [process]), "pid", [pid]);
}

const LEVELS: Choice[] = [
  { value: "debug", label: "debug+" },
  { value: "info", label: "info+" },
  { value: "warning", label: "warning+" },
  { value: "error", label: "error+" },
  { value: "critical", label: "critical" },
];

const PROCESSES: Choice[] = [
  { value: "cli", label: "cli" },
  { value: "daemon", label: "daemon" },
];

/** Each filtering column's choices; the process's also the one process chosen, if any. */
export function logChoices(params: Params): Record<string, Choice[]> {
  const process = oneProcess(params);
  return {
    level: LEVELS,
    time: SINCE,
    process: process === undefined ? PROCESSES : [...PROCESSES, { value: process, label: process }],
  };
}

/** The tab's title for these filters: `Log: warning+, daemon[4242]`. */
export function logTitle(filters: ColumnFiltersState, choices: Record<string, Choice[]>): string {
  return filteredTitle("Log", columns, filters, choices) ?? "Log";
}
