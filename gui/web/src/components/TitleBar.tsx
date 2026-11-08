import { Fragment, useSyncExternalStore } from "react";
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

/** What TypeScript's DOM types do not have yet: Chromium's `navigator.windowControlsOverlay`. */
interface WindowControlsOverlay extends EventTarget {
  readonly visible: boolean;
}

function overlay(): WindowControlsOverlay | undefined {
  return (navigator as { windowControlsOverlay?: WindowControlsOverlay }).windowControlsOverlay;
}

function onOverlayChange(changed: () => void): () => void {
  const controls = overlay();
  controls?.addEventListener("geometrychange", changed);
  return () => controls?.removeEventListener("geometrychange", changed);
}

/** Whether the window's buttons are over the bar's end: in the Desktop, not in a browser. */
function useWindowButtons(): boolean {
  return useSyncExternalStore(onOverlayChange, () => overlay()?.visible ?? false);
}

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
  const windowButtons = useWindowButtons();
  return (
    <header className={styles.bar} data-window-buttons={windowButtons || undefined}>
      <img className={styles.icon} src={icon} alt="" />
      <ViewMenu />
      <ColumnButtons />
    </header>
  );
}
