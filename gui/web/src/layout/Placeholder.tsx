import type { IWatermarkPanelProps } from "dockview-react";
import { openView } from "./dock";
import styles from "./layout.module.css";
import { ViewList } from "./ViewList";

/** What an empty Group shows: Views to open in it. */
export function Placeholder({ containerApi, group }: IWatermarkPanelProps) {
  return (
    <div className={styles.placeholder}>
      <p>Open a View:</p>
      <ViewList
        suggested
        open={(kind) => openView(containerApi, { kind, params: {} }, group?.id)}
      />
    </div>
  );
}
