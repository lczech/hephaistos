import { useSyncExternalStore } from "react";
import icon from "../../../../assets/icon.svg";
import styles from "./TitleBar.module.css";

// The window's title bar, where the Desktop leaves it to the page (the Window Controls
// Overlay): the window's buttons stay Chromium's, drawn over the bar's right end.

/** What TypeScript's DOM types don't have yet: Chromium's `navigator.windowControlsOverlay`. */
interface WindowControlsOverlay extends EventTarget {
  readonly visible: boolean;
}

function overlay(): WindowControlsOverlay | undefined {
  return (navigator as { windowControlsOverlay?: WindowControlsOverlay }).windowControlsOverlay;
}

function onOverlayChange(changed: () => void): () => void {
  const controls = overlay();
  controls?.addEventListener("geometrychange", changed);
  return () => controls?.removeEventListener("geometrychange", changed);
}

/** The bar at the top: the icon, dragging the window; only in the Desktop. */
export function TitleBar() {
  const shown = useSyncExternalStore(onOverlayChange, () => overlay()?.visible ?? false);
  if (!shown) return null;
  return (
    <header className={styles.bar}>
      <img className={styles.icon} src={icon} alt="" />
    </header>
  );
}
