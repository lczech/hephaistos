import { useDaemon, useObserve } from "../api/queries";
import { useNow } from "../useNow";
import styles from "./DaemonCard.module.css";
import { daemonText, lastPassText, serverText, watcherText } from "./daemonText";

/** How this Machine's Daemon is doing, as `hephaistos daemon status` shows it. */
export function DaemonCard() {
  const daemon = useDaemon();
  const observing = useObserve();
  const now = useNow();
  if (daemon.data === undefined) {
    const text = daemon.isError ? `No answer: ${daemon.error.message}` : "Asking the Daemon…";
    return (
      <section className={styles.card}>
        <h2 className={styles.title}>Daemon</h2>
        <p className={styles.quiet}>{text}</p>
      </section>
    );
  }
  const { daemon: process, watcher, server, warnings } = daemon.data;
  const rows: [string, string][] = [
    ["Daemon", daemonText(process, now)],
    ["Last pass", lastPassText(watcher?.last_pass ?? null, now)],
    ["Watcher", watcherText(watcher, now)],
    ["Server", serverText(server, now)],
  ];
  return (
    <section className={styles.card} data-stale={daemon.isError || undefined}>
      <h2 className={styles.title}>Daemon</h2>
      <dl className={styles.fields}>
        {rows.map(([label, text]) => (
          <div key={label} className={styles.field}>
            <dt>{label}</dt>
            <dd>{text}</dd>
          </div>
        ))}
      </dl>
      {warnings.map((warning) => (
        <p key={warning} className={styles.warning}>
          {warning}
        </p>
      ))}
      <div className={styles.actions}>
        <button type="button" onClick={() => observing.mutate()} disabled={observing.isPending}>
          {observing.isPending ? "Observing…" : "Observe now"}
        </button>
        {observing.isError && <p className={styles.error}>{observing.error.message}</p>}
      </div>
    </section>
  );
}
