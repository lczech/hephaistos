import { functionalUpdate } from "@tanstack/react-table";
import { useEffect } from "react";
import { useLog } from "../../api/queries";
import { ListTable } from "../../components/table/ListTable";
import { useListTable } from "../../components/table/list";
import { columnWidths } from "../../components/table/widths";
import { useNow } from "../../useNow";
import { withParam } from "../address";
import type { ViewProps } from "../index";
import { logChoices, logColumnFilters, logFilters, logParams, logTitle } from "./choices";
import { columns } from "./columns";
import { LogDetails } from "./LogDetails";
import styles from "./LogView.module.css";
import { type LogEntry, levelName, levelTone } from "./logText";

const NONE: LogEntry[] = [];

/**
 * What hephaistos did on this Machine, newest first: as `hephaistos log show --reverse` shows
 * it, filtered by its parameters as that is by its options.
 */
export function LogView({ params, setParams, setTitle }: ViewProps) {
  const filters = logFilters(params);
  const log = useLog(filters);
  const now = useNow(10_000);
  const pages = log.data?.pages;
  const listed = pages?.flatMap((page) => page.entries) ?? NONE;
  const columnFilters = logColumnFilters(params);
  const table = useListTable({
    columns,
    data: listed,
    getRowId: (entry) => entry.position,
    atoms: { columnSizing: columnWidths("log") },
    // The Server filters: the filters are the View's parameters, and changing one changes those.
    manualFiltering: true,
    state: { columnFilters },
    onColumnFiltersChange: (change) =>
      setParams(logParams(params, functionalUpdate(change, columnFilters))),
    meta: { now },
  });
  const choices = logChoices(params);
  const title = logTitle(columnFilters, choices);
  useEffect(() => setTitle(title), [title, setTitle]);
  let message: string | null = null;
  if (pages === undefined) {
    message = log.isError ? `Couldn't load: ${log.error.message}` : "Loading the log…";
  } else if (listed.length === 0) {
    message = columnFilters.length > 0 ? "No records match." : "No records yet.";
  } else if (pages.some((page) => page.skipped > 0)) {
    message = "Some lines in the log files aren't records.";
  }
  const onlyProcess = ({ record }: LogEntry) => {
    const pid = String(record.pid);
    if (record.pid === undefined || filters.pid === Number(pid)) return undefined;
    const process = typeof record.process === "string" ? [record.process] : [];
    return () => setParams(withParam(withParam(params, "process", process), "pid", [pid]));
  };
  return (
    <ListTable
      table={table}
      className={styles.log}
      choices={choices}
      message={message}
      stale={log.isError || log.isPlaceholderData}
      paging={log}
      older="records"
      tone={(entry) => levelTone(entry.record)}
      squareTitle={(entry) => levelName(entry.record)}
      detailsLabel="Record details"
      details={(entry) => <LogDetails entry={entry} now={now} onlyProcess={onlyProcess(entry)} />}
    />
  );
}
