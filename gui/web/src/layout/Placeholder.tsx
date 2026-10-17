import type { DockviewApi, IWatermarkPanelProps } from "dockview-react";
import { useCallback, useSyncExternalStore } from "react";
import { openView } from "./dock";
import styles from "./layout.module.css";
import { ViewList } from "./ViewList";

/** How many Groups there are, following them as they come and go. */
function useGroupCount(api: DockviewApi): number {
  const subscribe = useCallback(
    (changed: () => void) => {
      const added = api.onDidAddGroup(changed);
      const removed = api.onDidRemoveGroup(changed);
      return () => {
        added.dispose();
        removed.dispose();
      };
    },
    [api],
  );
  return useSyncExternalStore(subscribe, () => api.groups.length);
}

/** What an empty Group shows: Views to open in it, and, unless it is the last, closing it. */
export function Placeholder({ containerApi, group }: IWatermarkPanelProps) {
  const groups = useGroupCount(containerApi);
  return (
    <div className={styles.placeholder}>
      <p>Open a View:</p>
      <ViewList
        suggested
        open={(kind) => openView(containerApi, { kind, params: {} }, {}, group)}
      />
      {group && groups > 1 && (
        <button type="button" className={styles.close} onClick={() => group.api.close()}>
          Close this Group
        </button>
      )}
    </div>
  );
}
