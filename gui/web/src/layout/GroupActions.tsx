import type { IDockviewHeaderActionsProps } from "dockview-react";
import { Plus } from "lucide-react";
import { useRef } from "react";
import { placeBelow } from "../components/popover";
import popover from "../components/popover.module.css";
import { openView } from "./dock";
import styles from "./layout.module.css";
import { ViewList } from "./ViewList";
import { useSideButtons } from "./visits";

/** A Group's buttons next to its tabs: "+" opens a View in it. */
export function GroupActions({ containerApi, group }: IDockviewHeaderActionsProps) {
  const menu = useRef<HTMLDivElement>(null);
  const id = `views-${group.id}`;
  const sideButtons = useSideButtons(group);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the mouse's side buttons; Alt+←/→ by keyboard
    <div className={styles.actions} onMouseUp={sideButtons}>
      <button
        type="button"
        className={styles.add}
        popoverTarget={id}
        onClick={(event) => placeBelow(menu.current, event.currentTarget, "right")}
        title="Open a View"
        aria-label="Open a View"
      >
        <Plus className={styles.icon} aria-hidden />
      </button>
      <div id={id} ref={menu} popover="auto" className={popover.menu}>
        <ViewList
          menu={id}
          open={(kind) => openView(containerApi, { kind, params: {} }, {}, group)}
        />
      </div>
    </div>
  );
}
