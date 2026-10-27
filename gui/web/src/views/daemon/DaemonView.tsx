import { Eye } from "lucide-react";
import type { ReactNode } from "react";
import { type Connection, useConnection } from "../../api/live";
import { useDaemon, useObserve } from "../../api/queries";
import { TextIcon } from "../../components/TextIcon";
import { fullTime } from "../../time";
import { useNow } from "../../useNow";
import { ViewLink } from "../ViewLink";
import styles from "./DaemonView.module.css";
import { daemonText, lastPassText, serverText, watcherText } from "./daemonText";
import { retryText } from "./health";

type Lost = Extract<Connection, { state: "disconnected" }>;

/** What to check while the live connection is lost. */
function Disconnected({ connection, now }: { connection: Lost; now: number }) {
  const since = fullTime(new Date(connection.since).toISOString());
  return (
    <div className={styles.notice} role="status">
      <p>
        No connection to this machine's server since {since}; {retryText(connection.retryAt, now)}.
      </p>
      <p>
        Is the daemon running? <code>hephaistos daemon status</code>; to start it:{" "}
        <code>hephaistos daemon start</code>
      </p>
    </div>
  );
}

/** How this Machine's Daemon is doing, as `hephaistos daemon status` shows it. */
export function DaemonView() {
  const daemon = useDaemon();
  const observing = useObserve();
  const connection = useConnection();
  const now = useNow();
  const notice = connection.state === "disconnected" && (
    <Disconnected connection={connection} now={now} />
  );
  if (daemon.data === undefined) {
    const text = daemon.isError
      ? `Couldn't load: ${daemon.error.message}`
      : "Loading the daemon's status…";
    return (
      <section className={styles.view}>
        {notice}
        <p className={daemon.isError ? styles.problem : styles.quiet}>{text}</p>
      </section>
    );
  }
  const { daemon: process, watcher, server, warnings } = daemon.data;
  const log = process.pid !== null && (
    <ViewLink
      address={{ kind: "log", params: { process: "daemon", pid: String(process.pid) } }}
      label="The daemon's log"
      named
    />
  );
  const rows: [string, ReactNode][] = [
    [
      "Daemon",
      <>
        {daemonText(process, now)} {log}
      </>,
    ],
    ["Last pass", lastPassText(watcher?.last_pass ?? null, now)],
    ["Watcher", watcherText(watcher, now)],
    ["Server", serverText(server, now)],
  ];
  return (
    <section className={styles.view}>
      {notice}
      <div
        className={styles.status}
        data-stale={daemon.isError || connection.state === "disconnected" || undefined}
      >
        <dl className={styles.fields}>
          {rows.map(([label, text]) => (
            <div key={label} className={styles.field}>
              <dt>{label}</dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
        {warnings.map((warning) => (
          <p key={warning} className={styles.problem}>
            {warning}
          </p>
        ))}
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.observe}
            onClick={() => observing.mutate()}
            disabled={observing.isPending}
          >
            <TextIcon icon={Eye} />
            {observing.isPending ? "Observing…" : "Observe now"}
          </button>
          {observing.isError && <p className={styles.error}>{observing.error.message}</p>}
        </div>
      </div>
    </section>
  );
}
