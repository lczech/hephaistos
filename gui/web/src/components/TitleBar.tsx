import { Fragment } from "react";
import {
  Button,
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  Popover,
  Separator,
} from "react-aria-components";
import icon from "../../../../assets/icon.svg";
import { ColumnButtons } from "../layout/ColumnButtons";
import { viewIconClass } from "../views/families";
import { FAMILY_NAMES, KINDS, MENU_FAMILIES } from "../views/kinds";
import { useOpenView } from "../views/opening";
import popover from "./popover.module.css";
import { TextIcon } from "./TextIcon";
import styles from "./TitleBar.module.css";

/** The View menu: every kind that stands alone, by family, opened in the active Group. */
function ViewMenu() {
  const open = useOpenView();
  return (
    <MenuTrigger>
      <Button className={styles.menu}>View</Button>
      <Popover className={popover.popover} placement="bottom start">
        <Menu
          className={popover.menu}
          aria-label="Views"
          onAction={(kind) => open({ kind: String(kind), params: {} })}
        >
          {MENU_FAMILIES.map(({ family, kinds }, at) => (
            <Fragment key={family}>
              {at > 0 && <Separator className={popover.separator} />}
              <MenuSection aria-label={FAMILY_NAMES[family]}>
                {kinds.map((kind) => (
                  <MenuItem
                    key={kind}
                    id={kind}
                    className={styles.item}
                    textValue={KINDS[kind].name}
                  >
                    <TextIcon icon={KINDS[kind].icon} className={viewIconClass(kind)} />
                    {KINDS[kind].name}
                  </MenuItem>
                ))}
              </MenuSection>
            </Fragment>
          ))}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

/**
 * The bar at the top: the icon and the View menu, and at its end the buttons making columns of
 * Groups. In the Desktop it is the window's title
 * bar, dragging the window, the window's buttons drawn over its right end (the Window Controls
 * Overlay); in a browser, a bar like the others.
 */
export function TitleBar() {
  return (
    <header className={styles.bar}>
      <img className={styles.icon} src={icon} alt="" />
      <ViewMenu />
      <ColumnButtons />
    </header>
  );
}
