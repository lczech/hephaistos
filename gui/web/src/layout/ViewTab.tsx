import { DockviewDefaultTab, type IDockviewPanelHeaderProps } from "dockview-react";
import { useSyncExternalStore } from "react";
import { TextIcon } from "../components/TextIcon";
import { asAddress } from "../views/address";
import { viewIconClass } from "../views/families";
import { viewIcon } from "../views/kinds";
import { isPreview, keep, noteTab } from "./dock";
import styles from "./layout.module.css";
import { useSideButtons } from "./visits";

/**
 * A Panel's tab: its View's icon, then dockview's own tab with the title, cut off if long, and
 * close button; the whole title as its tooltip. A preview's is in italics; a double-click
 * keeps it. It fills dockview's tab (`dock.css`), so that a flash marks all of it.
 */
export function ViewTab(props: IDockviewPanelHeaderProps) {
  const address = asAddress(props.params);
  const Icon = address && viewIcon(address);
  const preview = isPreview(props.params);
  const sideButtons = useSideButtons(props.api.group);
  const { api } = props;
  const title = useSyncExternalStore(
    (changed) => {
      const titled = api.onDidTitleChange(changed);
      return () => titled.dispose();
    },
    () => api.title,
  );
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a shortcut for the mouse; changing the View keeps it too
    <div
      ref={(element) => {
        noteTab(api.id, element);
        return () => noteTab(api.id, null);
      }}
      className={preview ? `${styles.tab} ${styles.preview}` : styles.tab}
      onDoubleClick={() => keep(props.containerApi.getPanel(props.api.id))}
      title={title}
      onMouseUp={sideButtons}
    >
      {Icon && <TextIcon icon={Icon} className={viewIconClass(address.kind)} />}
      <DockviewDefaultTab {...props} />
    </div>
  );
}
