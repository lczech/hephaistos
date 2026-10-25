import { type Connection, useConnection } from "../api/live";
import { useDaemon, useInfo } from "../api/queries";
import { ago, fullTime } from "../time";
import { useNow } from "../useNow";
import { daemonHealth, disconnectedText, retryText } from "../views/daemon/health";
import { KINDS } from "../views/kinds";
import { useOpenView } from "../views/opening";
import styles from "./StatusBar.module.css";
import { TextIcon } from "./TextIcon";

const Icon = KINDS.daemon.icon;

/** The live connection, in a word, and in more words for its tooltip. */
function connectionText(connection: Connection, now: number): [string, string] {
  switch (connection.state) {
    case "connecting":
      return ["connecting…", "connecting to this machine's server"];
    case "live":
      return ["live", `connected since ${fullTime(new Date(connection.since).toISOString())}`];
    case "disconnected": {
      const since = fullTime(new Date(connection.since).toISOString());
      const next = retryText(connection.retryAt, now);
      return [disconnectedText(connection.since, now), `disconnected since ${since}; ${next}`];
    }
  }
}

/** One line at the bottom: this Machine; at its end, how the Daemon is doing and whether the
 * live connection to it is. The Daemon's icon opens the Daemon View. */
export function StatusBar() {
  const info = useInfo();
  const daemon = useDaemon();
  const connection = useConnection();
  const open = useOpenView();
  const now = useNow();
  const { health, reasons } = daemonHealth(connection, daemon.data, now);
  const lastPass = daemon.data?.watcher?.last_pass;
  const title = `Daemon: ${reasons.join("; ")}${lastPass ? `; last pass ${ago(lastPass.finished_at, now)}` : ""}`;
  const [text, details] = connectionText(connection, now);
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
          title={title}
          aria-label={`Daemon: ${reasons.join("; ")}; open the Daemon view`}
        >
          <TextIcon icon={Icon} />
        </button>
        <span className={styles.text} data-state={connection.state} title={details}>
          {text}
        </span>
      </span>
    </footer>
  );
}
