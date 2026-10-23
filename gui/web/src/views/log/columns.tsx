import { Chevron } from "../../components/table/ListTable";
import { listColumnHelper } from "../../components/table/list";
import { ago, preciseTime } from "../../time";
import styles from "./LogView.module.css";
import { extraFields, type LogEntry, processText, tracebackEnd } from "./logText";

const column = listColumnHelper<LogEntry>();

/** One line, as `log show` prints it: the message, what went wrong, and the other fields. */
function Message({ entry }: { entry: LogEntry }) {
  const { record } = entry;
  const message = String(record.message);
  const end = tracebackEnd(record);
  const fields = extraFields(record)
    .map(([key, text]) => `${key}=${text}`)
    .join(" ");
  return (
    <>
      {message}
      {end !== undefined && <span className={styles.traceback}> ↳ {end}</span>}
      {fields && <span className={styles.fields}> {fields}</span>}
    </>
  );
}

/**
 * The Log list's columns. Their filters are those of `/api/log`, by the same names.
 */
export const columns = column.columns([
  column.display({
    id: "level", // a square, coloured for warnings and worse
    cell: Chevron,
    enableResizing: false,
    meta: { width: "var(--square)", filter: { param: "level" } },
  }),
  column.display({
    id: "time",
    header: "time",
    size: 180,
    meta: { filter: { param: "since" } },
    cell: ({ row, table }) => {
      const at = String(row.original.record.at);
      const now = table.options.meta?.now ?? Date.now();
      return <span title={ago(at, now)}>{preciseTime(at)}</span>;
    },
  }),
  column.display({
    id: "process",
    header: "process",
    size: 140,
    meta: { filter: { param: "process" } },
    cell: ({ row }) => processText(row.original.record),
  }),
  column.display({
    id: "message",
    header: "message",
    cell: ({ row }) => <Message entry={row.original} />,
    size: 560,
  }),
]);
