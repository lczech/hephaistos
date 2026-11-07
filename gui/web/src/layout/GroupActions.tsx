import type { IDockviewHeaderActionsProps } from "dockview-react";
import { Plus } from "lucide-react";
import { Menu, MenuItem, MenuTrigger, Popover, Pressable } from "react-aria-components";
import popover from "../components/popover.module.css";
import { TextIcon } from "../components/TextIcon";
import { viewIconClass } from "../views/families";
import { AT_HAND, KINDS } from "../views/kinds";
import { openView } from "./dock";
import styles from "./layout.module.css";
import { useSideButtons } from "./visits";

/** A Group's buttons next to its tabs: "+" opens a View at hand in it; the View menu has all. */
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
            {AT_HAND.map((kind) => {
              const { name, icon } = KINDS[kind];
              return (
                <MenuItem key={kind} id={kind} className={styles.choice} textValue={name}>
                  <TextIcon icon={icon} className={viewIconClass(kind)} />
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
