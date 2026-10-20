import type { IDockviewPanelProps } from "dockview-react";
import { Boundary } from "../components/Boundary";
import { viewComponent } from "../views";
import { type Address, asAddress, type Params } from "../views/address";
import { type Opening, OpenViewContext } from "../views/opening";
import { noteTyped, openView, PREVIEW } from "./dock";
import styles from "./layout.module.css";

/** A Panel's content: the View its parameters name, kept from failing the other Panels. */
export function PanelView({ api, containerApi, params }: IDockviewPanelProps) {
  const address = asAddress(params);
  const name = address?.kind;
  // Changing a preview keeps it.
  const setParams = (changed: Params, typed = false) => {
    noteTyped({ api }, typed);
    api.updateParameters({ kind: name, params: changed, [PREVIEW]: undefined });
  };
  const setTitle = (title: string) => api.setTitle(title);
  const open = (shown: Address, opening?: Opening) =>
    openView(containerApi, shown, opening, api.group);
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
