import type { DockviewApi } from "dockview-react";
import { Columns2, Columns3, Columns4, type LucideIcon, Square } from "lucide-react";
import { useSyncExternalStore } from "react";
import { arrangeColumns, COUNTS, columnCount } from "./columns";
import styles from "./layout.module.css";
import { useDock } from "./ViewOpener";

const ICONS: Record<(typeof COUNTS)[number], LucideIcon> = {
  1: Square,
  2: Columns2,
  3: Columns3,
  4: Columns4,
};

/** How many columns the Workbench has at its top, following it as it changes; none without it. */
function useColumnCount(api: DockviewApi | null): number | null {
  const subscribe = (changed: () => void) => {
    const changes = api?.onDidLayoutChange(changed);
    return () => changes?.dispose();
  };
  return useSyncExternalStore(subscribe, () => (api ? columnCount(api.toJSON().grid) : null));
}

/** Buttons making 1 to 4 columns of Groups (`columns.ts`), the current count's pressed. */
export function ColumnButtons() {
  const api = useDock();
  const current = useColumnCount(api);
  if (api === null) return null;
  return (
    <div className={styles.columns}>
      {COUNTS.map((count) => {
        const Icon = ICONS[count];
        const label = count === 1 ? "One column" : `${count} columns`;
        const pressed = current === count;
        return (
          <button
            key={count}
            type="button"
            className={styles.column}
            title={pressed ? `${label}: even out their widths` : label}
            aria-label={label}
            aria-pressed={pressed}
            onClick={() => arrangeColumns(api, count)}
          >
            <Icon aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
