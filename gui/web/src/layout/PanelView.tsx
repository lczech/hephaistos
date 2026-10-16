import type { IDockviewPanelProps } from "dockview-react";
import { useCallback } from "react";
import { Boundary } from "../components/Boundary";
import { viewComponent } from "../views";
import { type Address, asAddress, type Params } from "../views/address";
import { type Opening, OpenViewContext } from "../views/opening";
import { openView, PREVIEW } from "./dock";
import styles from "./layout.module.css";

/** A Panel's content: the View its parameters name, kept from failing the other Panels. */
export function PanelView({ api, containerApi, params }: IDockviewPanelProps) {
  const address = asAddress(params);
  const name = address?.kind;
  const setParams = useCallback(
    // Changing a preview keeps it.
    (changed: Params) =>
      api.updateParameters({ kind: name, params: changed, [PREVIEW]: undefined }),
    [api, name],
  );
  const setTitle = useCallback((title: string) => api.setTitle(title), [api]);
  const open = useCallback(
    (shown: Address, opening?: Opening) => openView(containerApi, shown, opening, api.group),
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
