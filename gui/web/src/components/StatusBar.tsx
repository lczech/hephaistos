import { useInfo } from "../api/queries";
import { ago } from "../time";
import { useNow } from "../useNow";
import styles from "./StatusBar.module.css";

/** One line at the bottom: this Machine, and whether its Server answers. */
export function StatusBar() {
  const info = useInfo();
  const now = useNow();
  const answered = info.dataUpdatedAt > 0 ? ago(info.dataUpdatedAt, now) : null;
  let state: "connected" | "waiting" | "lost" = "waiting";
  let text = "connecting…";
  if (info.isError) {
    state = "lost";
    text = `no answer: ${info.error.message}`;
    if (answered !== null) text += `; last answer ${answered}`;
  } else if (answered !== null) {
    state = "connected";
    text = `updated ${answered}`;
  }
  const where =
    info.data &&
    `${info.data.machine.name} · hephaistos ${info.data.version}` +
      ` · API ${info.data.api.major}.${info.data.api.minor}`;
  return (
    <footer className={styles.bar}>
      <span className={styles.dot} data-state={state} title={state} />
      {where && <span>{where}</span>}
      <span className={styles.end}>{text}</span>
    </footer>
  );
}
