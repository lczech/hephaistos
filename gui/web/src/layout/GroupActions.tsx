import type { IDockviewHeaderActionsProps } from "dockview-react";
import type { MouseEvent } from "react";
import { useRef } from "react";
import { openView } from "./dock";
import styles from "./layout.module.css";
import { ViewList } from "./ViewList";

/** A Group's buttons next to its tabs: "+" opens a View in it. */
export function GroupActions({ containerApi, group }: IDockviewHeaderActionsProps) {
  const menu = useRef<HTMLDivElement>(null);
  const id = `views-${group.id}`;
  // The menu opens in the top layer, so nothing clips it; it goes below the button.
  const place = (event: MouseEvent<HTMLButtonElement>) => {
    const button = event.currentTarget.getBoundingClientRect();
    menu.current?.style.setProperty("top", `${button.bottom}px`);
    menu.current?.style.setProperty(
      "right",
      `${document.documentElement.clientWidth - button.right}px`,
    );
  };
  return (
    <div className={styles.actions}>
      <button
        type="button"
        className={styles.add}
        popoverTarget={id}
        onClick={place}
        title="Open a View"
        aria-label="Open a View"
      >
        +
      </button>
      <div id={id} ref={menu} popover="auto" className={styles.menu}>
        <ViewList
          menu={id}
          open={(kind) =>
            openView(containerApi, { kind, params: {} }, { referenceGroup: group.id })
          }
        />
      </div>
    </div>
  );
}
