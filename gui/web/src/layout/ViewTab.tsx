import { DockviewDefaultTab, type IDockviewPanelHeaderProps } from "dockview-react";
import { asAddress } from "../views/address";
import { viewKind } from "../views/kinds";
import { isPreview, keep } from "./dock";
import styles from "./layout.module.css";

/**
 * A Panel's tab: its View's icon, then dockview's own tab with the title and close button.
 * A preview's is in italics; a double-click keeps it.
 */
export function ViewTab(props: IDockviewPanelHeaderProps) {
  const address = asAddress(props.params);
  const Icon = address && viewKind(address.kind)?.icon;
  const preview = isPreview(props.params);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a shortcut for the mouse; changing the View keeps it too
    <div
      className={preview ? `${styles.tab} ${styles.preview}` : styles.tab}
      onDoubleClick={() => keep(props.containerApi.getPanel(props.api.id))}
    >
      {Icon && <Icon className={styles.icon} aria-hidden="true" />}
      <DockviewDefaultTab {...props} />
    </div>
  );
}
