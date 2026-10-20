import type { IDockviewPanelProps } from "dockview-react";
import { useEffect, useState } from "react";
import { Boundary } from "../components/Boundary";
import { viewComponent } from "../views";
import { type Address, asAddress, type Params } from "../views/address";
import { type Opening, OpenViewContext } from "../views/opening";
import { noteTyped, openView, PREVIEW } from "./dock";
import styles from "./layout.module.css";

/**
 * A Panel's content: the View its parameters name, kept from failing the other Panels. Built once
 * its tab is first shown, so a View never looked at costs nothing, e.g. a Diff asks for no files;
 * from then on kept, drawn while hidden (dockview's `always`): its scroll positions stay, and it
 * shows again at once, e.g. all of a Diff's lines. It is drawn over its Group, not in it: it is
 * found by its Panel.
 */
export function PanelView({ api, containerApi, params }: IDockviewPanelProps) {
  const [shown, setShown] = useState(api.isVisible);
  useEffect(() => {
    if (shown) return;
    if (api.isVisible) return setShown(true);
    const visible = api.onDidVisibilityChange(({ isVisible }) => {
      if (isVisible) setShown(true);
    });
    return () => visible.dispose();
  }, [api, shown]);
  const address = asAddress(params);
  const name = address?.kind;
  // Changing a preview keeps it.
  const setParams = (changed: Params, typed = false) => {
    noteTyped({ api }, typed);
    api.updateParameters({ kind: name, params: changed, [PREVIEW]: undefined });
  };
  const setTitle = (title: string) => api.setTitle(title);
  const open = (other: Address, opening?: Opening) =>
    openView(containerApi, other, opening, api.group);
  const View = address && viewComponent(address.kind);
  if (!shown) return null;
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
