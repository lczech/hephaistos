import type { DockviewApi, IWatermarkPanelProps } from "dockview-react";
import { useSyncExternalStore } from "react";
import { openView } from "./dock";
import styles from "./layout.module.css";
import { ViewList } from "./ViewList";
import { useSideButtons } from "./visits";

/** How many Groups there are, following them as they come and go. */
function useGroupCount(api: DockviewApi): number {
  const subscribe = (changed: () => void) => {
    const added = api.onDidAddGroup(changed);
    const removed = api.onDidRemoveGroup(changed);
    return () => {
      added.dispose();
      removed.dispose();
    };
  };
  return useSyncExternalStore(subscribe, () => api.groups.length);
}

/** What an empty Group shows: Views to open in it, and, unless it is the last, closing it. */
export function Placeholder({ containerApi, group }: IWatermarkPanelProps) {
  const groups = useGroupCount(containerApi);
  const sideButtons = useSideButtons(group);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the mouse's side buttons; Alt+←/→ by keyboard
    <div className={styles.placeholder} onMouseUp={sideButtons}>
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
