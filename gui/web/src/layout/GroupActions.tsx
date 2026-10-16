import type { IDockviewHeaderActionsProps } from "dockview-react";
import { useRef } from "react";
import { placeBelow } from "../components/popover";
import popover from "../components/popover.module.css";
import { openView } from "./dock";
import styles from "./layout.module.css";
import { ViewList } from "./ViewList";

/** A Group's buttons next to its tabs: "+" opens a View in it. */
export function GroupActions({ containerApi, group }: IDockviewHeaderActionsProps) {
  const menu = useRef<HTMLDivElement>(null);
  const id = `views-${group.id}`;
  return (
    <div className={styles.actions}>
      <button
        type="button"
        className={styles.add}
        popoverTarget={id}
        onClick={(event) => placeBelow(menu.current, event.currentTarget, "right")}
        title="Open a View"
        aria-label="Open a View"
      >
        +
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
