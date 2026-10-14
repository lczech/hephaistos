import { DockviewDefaultTab, type IDockviewPanelHeaderProps } from "dockview-react";
import { viewKind } from "../views";
import { asAddress } from "../views/address";
import styles from "./layout.module.css";

/** A Panel's tab: its View's icon, then dockview's own tab with the title and close button. */
export function ViewTab(props: IDockviewPanelHeaderProps) {
  const address = asAddress(props.params);
  const Icon = address && viewKind(address.kind)?.icon;
  return (
    <div className={styles.tab}>
      {Icon && <Icon className={styles.icon} aria-hidden="true" />}
      <DockviewDefaultTab {...props} />
    </div>
  );
}
