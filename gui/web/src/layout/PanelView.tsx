import type { IDockviewPanelProps } from "dockview-react";
import { useCallback } from "react";
import { Boundary } from "../components/Boundary";
import { viewKind } from "../views";
import { asAddress, type Params } from "../views/address";
import styles from "./layout.module.css";

/** A Panel's content: the View its parameters name, kept from failing the other Panels. */
export function PanelView({ api, params }: IDockviewPanelProps) {
  const address = asAddress(params);
  const name = address?.kind;
  const setParams = useCallback(
    (changed: Params) => api.updateParameters({ kind: name, params: changed }),
    [api, name],
  );
  const setTitle = useCallback((title: string) => api.setTitle(title), [api]);
  const kind = address && viewKind(address.kind);
  if (!address || !kind) {
    return <p className={styles.gone}>This View no longer exists; close its tab.</p>;
  }
  const View = kind.component;
  return (
    <div className={styles.panel}>
      <Boundary>
        <View params={address.params} setParams={setParams} setTitle={setTitle} />
      </Boundary>
    </div>
  );
}
