import { Fields } from "../../components/table/Fields";
import table from "../../components/table/table.module.css";
import { ago, preciseTime } from "../../time";
import styles from "./LogView.module.css";
import { extraFields, type LogEntry, levelName, processText } from "./logText";

interface Props {
  entry: LogEntry;
  now: number;
  onlyProcess?: () => void; // shows only the records of its process; none if they are already
}

const TRACEBACKS = [
  ["error", "traceback"],
  ["stack", "stack"],
] as const;

/** Everything about a log record, as `hephaistos log show --json` has it. */
export function LogDetails({ entry, now, onlyProcess }: Props) {
  const { record, position } = entry;
  const at = String(record.at);
  const fields = extraFields(record);
  return (
    <>
      <Fields
        fields={[
          ["time", `${preciseTime(at)} (${ago(at, now)})`],
          ["level", levelName(record)],
          ["process", processText(record)],
          ["logger", String(record.logger ?? "-")],
          ["message", String(record.message)],
          ["position", position],
        ]}
      />
      {fields.length > 0 && <Fields title="fields" fields={fields} />}
      {TRACEBACKS.map(
        ([key, title]) =>
          record[key] !== undefined && (
            <div key={key}>
              <p className={table.title}>{title}</p>
              <pre className={styles.traceback}>{String(record[key])}</pre>
            </div>
          ),
      )}
      {onlyProcess !== undefined && (
        <p className={styles.actions}>
          <button type="button" onClick={onlyProcess}>
            Only this process
          </button>
        </p>
      )}
    </>
  );
}
