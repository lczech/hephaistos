import type { IDockviewPanelProps } from "dockview-react";
import { Boundary } from "../components/Boundary";
import { viewKind, viewTitle } from "../views";
import { type Address, asAddress } from "../views/address";
import styles from "./layout.module.css";

/** A Panel's content: the View its parameters name, kept from failing the other Panels. */
export function PanelView({ api, params }: IDockviewPanelProps) {
  const address = asAddress(params);
  const kind = address && viewKind(address.kind);
  if (!address || !kind) {
    return <p className={styles.gone}>This View no longer exists; close its tab.</p>;
  }
  const View = kind.component;
  const setParams = (next: Address["params"]) => {
    const changed = { kind: address.kind, params: next };
    api.updateParameters(changed);
    api.setTitle(viewTitle(changed));
  };
  return (
    <div className={styles.panel}>
      <Boundary>
        <View params={address.params} setParams={setParams} />
      </Boundary>
    </div>
  );
}
