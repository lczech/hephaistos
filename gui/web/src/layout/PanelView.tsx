import type { IDockviewPanelProps } from "dockview-react";
import { useEffect, useState } from "react";
import { Boundary } from "../components/Boundary";
import { viewComponent } from "../views";
import { type Address, asAddress, type Params } from "../views/address";
import { KeyTargetContext, type NoteKeyTarget } from "../views/keys";
import { type Opening, OpenViewContext } from "../views/opening";
import { noteKeyTarget, noteTyped, openView, PREVIEW } from "./dock";
import styles from "./layout.module.css";
import { useSideButtons } from "./visits";

/**
 * A Panel's content: the View its parameters name, kept from failing the other Panels. Built once
 * its tab is first shown, so a View never looked at costs nothing, e.g. a Diff asks for no files;
 * from then on kept, drawn while hidden (dockview's `always`): its scroll positions stay, and it
 * shows again at once, e.g. all of a Diff's lines. Drawn over its Group, not in it, it is known
 * by its Panel, never by where its elements are: where keys go in it, and its Group, for the
 * mouse's side buttons.
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
  const endTyping = () => noteTyped({ api }, false);
  const setTitle = (title: string) => api.setTitle(title);
  const open = (other: Address, opening?: Opening) =>
    openView(containerApi, other, opening, api.group);
  const noteTarget: NoteKeyTarget = (target, element) => noteKeyTarget(api.id, target, element);
  const sideButtons = useSideButtons(api.group);
  const View = address && viewComponent(address.kind);
  if (!shown) return null;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the mouse's side buttons; Alt+←/→ by keyboard
    <div className={styles.panel} onMouseUp={sideButtons}>
      {address && View ? (
        <Boundary>
          <OpenViewContext value={open}>
            <KeyTargetContext value={noteTarget}>
              <View
                params={address.params}
                setParams={setParams}
                endTyping={endTyping}
                setTitle={setTitle}
              />
            </KeyTargetContext>
          </OpenViewContext>
        </Boundary>
      ) : (
        <p className={styles.gone}>This View no longer exists; close its tab.</p>
      )}
    </div>
  );
}
