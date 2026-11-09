import { useAtom } from "@tanstack/react-store";
import { type Connection, useConnection } from "../api/live";
import { useDaemon, useInfo } from "../api/queries";
import { HEALTH_ICONS } from "../icons";
import { noticeAtom } from "../notice";
import { ago, fullTime } from "../time";
import { useNow } from "../useNow";
import { useOpenView } from "../views/opening";
import { disconnectedText, retryText, useHealth } from "../views/status/health";
import styles from "./StatusBar.module.css";
import { TextIcon } from "./TextIcon";

/** The live connection, in a word, and in more words for its tooltip. */
function connectionText(connection: Connection, now: number): [string, string] {
  switch (connection.state) {
    case "connecting":
      return ["connecting…", "connecting to this machine's server"];
    case "live":
      return ["live", `connected since ${fullTime(connection.since)}`];
    case "disconnected": {
      const since = fullTime(connection.since);
      const next = retryText(connection.retryAt, now);
      return [disconnectedText(connection.since, now), `disconnected since ${since}; ${next}`];
    }
  }
}

/** One line at the bottom: this Machine, or for a while what was just done (`notify`); at its
 * end, how its setup and Daemon are doing, and whether the live connection is. The health icon
 * opens the Status View. */
export function StatusBar() {
  const info = useInfo();
  const daemon = useDaemon();
  const connection = useConnection();
  const open = useOpenView();
  const now = useNow();
  const [notice] = useAtom(noticeAtom);
  const { health, reasons } = useHealth();
  const Icon = HEALTH_ICONS[health];
  const lastPass = daemon.data?.watcher?.last_pass;
  const title = `Status: ${reasons.join("; ")}${lastPass ? `; last pass ${ago(lastPass.finished_at, now)}` : ""}`;
  const [text, details] = connectionText(connection, now);
  const where =
    info.data &&
    `${info.data.machine.name} · hephaistos ${info.data.version}` +
      ` · API ${info.data.api.major}.${info.data.api.minor}`;
  return (
    <footer className={styles.bar}>
      {/* Always there, so that a screen reader says each notice as its text comes. */}
      <span className={styles.notice} role="status">
        {notice}
      </span>
      {!notice && where && <span>{where}</span>}
      <span className={styles.end}>
        <button
          type="button"
          className={styles.health}
          data-health={health}
          onClick={() => open({ kind: "status", params: {} })}
          title={title}
          aria-label={`Status: ${reasons.join("; ")}; open the Status view`}
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
