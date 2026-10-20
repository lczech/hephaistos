import { DockviewDefaultTab, type IDockviewPanelHeaderProps } from "dockview-react";
import type { PointerEvent } from "react";
import { asAddress } from "../views/address";
import { viewIcon } from "../views/kinds";
import { isPreview, keep } from "./dock";
import styles from "./layout.module.css";
import { useSideButtons } from "./visits";

/** Gives the title its whole text as a tooltip while cut off. */
function showCutOff(event: PointerEvent<HTMLElement>) {
  const title = event.currentTarget.querySelector(".dv-default-tab-content");
  if (!(title instanceof HTMLElement)) return;
  if (title.scrollWidth > title.clientWidth) title.title = title.textContent ?? "";
  else title.removeAttribute("title");
}

/**
 * A Panel's tab: its View's icon, then dockview's own tab with the title, cut off if long, and
 * close button. A preview's is in italics; a double-click keeps it.
 */
export function ViewTab(props: IDockviewPanelHeaderProps) {
  const address = asAddress(props.params);
  const Icon = address && viewIcon(address);
  const preview = isPreview(props.params);
  const sideButtons = useSideButtons(props.api.group);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a shortcut for the mouse; changing the View keeps it too
    <div
      className={preview ? `${styles.tab} ${styles.preview}` : styles.tab}
      onDoubleClick={() => keep(props.containerApi.getPanel(props.api.id))}
      onPointerEnter={showCutOff}
      onMouseUp={sideButtons}
    >
      {Icon && <Icon className={styles.icon} aria-hidden="true" />}
      <DockviewDefaultTab {...props} />
    </div>
  );
}
