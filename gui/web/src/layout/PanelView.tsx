import type { IDockviewPanelProps } from "dockview-react";
import { useCallback } from "react";
import { Boundary } from "../components/Boundary";
import { viewComponent } from "../views";
import { type Address, asAddress, type Params } from "../views/address";
import { OpenViewContext } from "../views/opening";
import { openView } from "./dock";
import styles from "./layout.module.css";

/** A Panel's content: the View its parameters name, kept from failing the other Panels. */
export function PanelView({ api, containerApi, params }: IDockviewPanelProps) {
  const address = asAddress(params);
  const name = address?.kind;
  const setParams = useCallback(
    (changed: Params) => api.updateParameters({ kind: name, params: changed }),
    [api, name],
  );
  const setTitle = useCallback((title: string) => api.setTitle(title), [api]);
  const open = useCallback(
    (shown: Address) => openView(containerApi, shown, { referenceGroup: api.group.id }),
    [api, containerApi],
  );
  const View = address && viewComponent(address.kind);
  if (!address || !View) {
    return <p className={styles.gone}>This View no longer exists; close its tab.</p>;
  }
  return (
    <div className={styles.panel}>
      <Boundary>
        <OpenViewContext value={open}>
          <View params={address.params} setParams={setParams} setTitle={setTitle} />
        </OpenViewContext>
      </Boundary>
    </div>
  );
}
