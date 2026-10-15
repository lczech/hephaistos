import { useDaemon, useInfo } from "../api/queries";
import { ago } from "../time";
import { useNow } from "../useNow";
import { daemonHealth } from "../views/daemon/health";
import { KINDS } from "../views/kinds";
import { useOpenView } from "../views/opening";
import styles from "./StatusBar.module.css";

const Icon = KINDS.daemon.icon;

/** One line at the bottom: this Machine; at its end, how the Daemon is doing and when it last
 * answered. The Daemon's icon opens the Daemon View. */
export function StatusBar() {
  const info = useInfo();
  const daemon = useDaemon();
  const open = useOpenView();
  const now = useNow();
  const answered = info.dataUpdatedAt > 0 ? ago(info.dataUpdatedAt, now) : null;
  const { health, reasons } = daemonHealth(
    answered !== null,
    info.isError ? info.error.message : null,
    daemon.data,
  );
  let text = "connecting…";
  if (info.isError) text = `no answer: ${info.error.message}`;
  else if (answered !== null) text = `updated ${answered}`;
  if (info.isError && answered !== null) text += `; last answer ${answered}`;
  const where =
    info.data &&
    `${info.data.machine.name} · hephaistos ${info.data.version}` +
      ` · API ${info.data.api.major}.${info.data.api.minor}`;
  return (
    <footer className={styles.bar}>
      {where && <span>{where}</span>}
      <span className={styles.end}>
        <button
          type="button"
          className={styles.health}
          data-health={health}
          onClick={() => open({ kind: "daemon", params: {} })}
          title={`Daemon: ${reasons.join("; ")}`}
          aria-label={`Daemon: ${reasons.join("; ")}; show it`}
        >
          <Icon aria-hidden="true" />
        </button>
        <span className={styles.text}>{text}</span>
      </span>
    </footer>
  );
}
