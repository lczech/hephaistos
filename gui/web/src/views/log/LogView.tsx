import { functionalUpdate } from "@tanstack/react-table";
import { useLog } from "../../api/queries";
import { useListLayout } from "../../components/table/kept";
import { LayoutToggle } from "../../components/table/LayoutToggle";
import { ListTable } from "../../components/table/ListTable";
import { useListTable } from "../../components/table/list";
import { BarEnd, ViewBar, ViewPage } from "../../components/ViewBar";
import { useNow } from "../../useNow";
import { withParam } from "../address";
import type { ViewProps } from "../index";
import { useTitle } from "../title";
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
  const [layout, setLayout] = useListLayout("log");
  const table = useListTable("log", layout, {
    columns,
    data: listed,
    getRowId: (entry) => entry.position,
    // The Server filters: the filters are the View's parameters, and changing one changes those.
    manualFiltering: true,
    state: { columnFilters },
    onColumnFiltersChange: (change) =>
      setParams(logParams(params, functionalUpdate(change, columnFilters))),
    meta: { now },
  });
  const choices = logChoices(params);
  const title = logTitle(columnFilters, choices);
  useTitle(setTitle, title);
  let message: string | null = null;
  let problem = false;
  if (pages === undefined) {
    message = log.isError ? `Couldn't load: ${log.error.message}` : "Loading the log…";
    problem = log.isError;
  } else if (listed.length === 0) {
    message = columnFilters.length > 0 ? "No records match." : "No records yet.";
  } else if (pages.some((page) => page.skipped > 0)) {
    message = "Some lines in the log files aren't records.";
    problem = true;
  }
  const onlyProcess = ({ record }: LogEntry) => {
    const pid = String(record.pid);
    if (record.pid === undefined || filters.pid === Number(pid)) return undefined;
    const process = typeof record.process === "string" ? [record.process] : [];
    return () => setParams(withParam(withParam(params, "process", process), "pid", [pid]));
  };
  return (
    <ViewPage>
      <ViewBar>
        <BarEnd>
          <LayoutToggle layout={layout} onChange={setLayout} />
        </BarEnd>
      </ViewBar>
      <ListTable
        table={table}
        className={styles.log}
        layout={layout}
        choices={choices}
        message={message}
        problem={problem}
        stale={log.isError || log.isPlaceholderData}
        paging={log}
        older="records"
        tone={(entry) => levelTone(entry.record)}
        squareTitle={(entry) => levelName(entry.record)}
        detailsLabel="Record details"
        details={(entry) => <LogDetails entry={entry} now={now} onlyProcess={onlyProcess(entry)} />}
      />
    </ViewPage>
  );
}
