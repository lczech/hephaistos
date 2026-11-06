import type { LucideIcon } from "lucide-react";
import { Fragment, type RefObject } from "react";
import { Menu, MenuItem, MenuSection, Popover, Separator } from "react-aria-components";
import popover from "../popover.module.css";
import { TextIcon } from "../TextIcon";
import styles from "./ColumnsMenu.module.css";

/** Something to do with a row, in its menu: its label after its icon, coloured by `iconClass`. */
export interface RowAction {
  id: string;
  label: string;
  icon: LucideIcon;
  iconClass?: string; // e.g. the family's colour of the View it opens
  onAction: () => void;
}

interface Props {
  label: string; // what the menu is of: `Actions on main.py`
  groups: RowAction[][]; // shown one under the other, a line between them
  anchor: RefObject<HTMLElement | null>; // where it was asked for
  keyboard: boolean; // whether by the keyboard: then its first item is focused
  onClose: () => void;
}

/** A row's menu: what can be done with it, in groups, each by its icon and label. */
export function RowMenu({ label, groups, anchor, keyboard, onClose }: Props) {
  const shown = groups.filter((group) => group.length > 0);
  return (
    <Popover
      className={popover.popover}
      triggerRef={anchor}
      isOpen
      onOpenChange={(open) => open || onClose()}
      placement="bottom start"
    >
      <Menu
        className={popover.menu}
        aria-label={label}
        autoFocus={keyboard ? "first" : true}
        onClose={onClose}
        onContextMenu={(event) => {
          event.preventDefault(); // nor is it for the row below
          event.stopPropagation();
        }}
      >
        {shown.map((group, index) => (
          <Fragment key={group.map(({ id }) => id).join(" ")}>
            {index > 0 && <Separator className={popover.separator} />}
            <MenuSection aria-label={group.map(({ label }) => label).join(", ")}>
              {group.map((action) => (
                <MenuItem
                  key={action.id}
                  id={action.id}
                  className={styles.item}
                  textValue={action.label}
                  onAction={action.onAction}
                >
                  <span className={styles.label}>
                    <TextIcon icon={action.icon} className={action.iconClass} />
                    {action.label}
                  </span>
                </MenuItem>
              ))}
            </MenuSection>
          </Fragment>
        ))}
      </Menu>
    </Popover>
  );
}
