import type { IDockviewPanelProps } from "dockview-react";
import { Boundary } from "../components/Boundary";
import { viewKind } from "../views";
import { panelAddress } from "../views/address";
import styles from "./layout.module.css";

/** A Panel's content: the View its ID names, kept from failing the other Panels. */
export function PanelView({ api }: IDockviewPanelProps) {
  const address = panelAddress(api.id);
  const kind = address && viewKind(address.kind);
  if (!address || !kind) {
    return <p className={styles.gone}>This View no longer exists; close its tab.</p>;
  }
  const View = kind.component;
  return (
    <div className={styles.panel}>
      <Boundary>
        <View params={address.params} />
      </Boundary>
    </div>
  );
}
