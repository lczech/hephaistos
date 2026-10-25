import type { IDockviewHeaderActionsProps } from "dockview-react";
import { Plus } from "lucide-react";
import { Menu, MenuItem, MenuTrigger, Popover, Pressable } from "react-aria-components";
import popover from "../components/popover.module.css";
import { TextIcon } from "../components/TextIcon";
import { KINDS, type KindName } from "../views/kinds";
import { openView } from "./dock";
import styles from "./layout.module.css";
import { useSideButtons } from "./visits";

// The kinds of View that stand alone, without what others are opened from (e.g. a Checkout).
const OFFERED: KindName[] = ["repositories", "events", "daemon", "log", "config", "db"];

/** A Group's buttons next to its tabs: "+" opens a View in it. */
export function GroupActions({ containerApi, group }: IDockviewHeaderActionsProps) {
  const sideButtons = useSideButtons(group);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the mouse's side buttons; Alt+←/→ by keyboard
    <div className={styles.actions} onMouseUp={sideButtons}>
      <MenuTrigger>
        {/* Our own button, for its tooltip: React Aria's has none. */}
        <Pressable>
          <button type="button" className={styles.add} title="Open a view" aria-label="Open a view">
            <Plus aria-hidden />
          </button>
        </Pressable>
        <Popover className={popover.popover} placement="bottom end">
          <Menu
            className={`${styles.views} ${popover.menu}`}
            aria-label="Views"
            onAction={(kind) =>
              openView(containerApi, { kind: String(kind), params: {} }, {}, group)
            }
          >
            {OFFERED.map((kind) => {
              const { name, icon } = KINDS[kind];
              return (
                <MenuItem key={kind} id={kind} className={styles.choice} textValue={name}>
                  <TextIcon icon={icon} />
                  {name}
                </MenuItem>
              );
            })}
          </Menu>
        </Popover>
      </MenuTrigger>
    </div>
  );
}
