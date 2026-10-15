import { useSyncExternalStore } from "react";
import styles from "./App.module.css";
import { useInfo, useObserveOnFocus } from "./api/queries";
import { StatusBar } from "./components/StatusBar";
import { TokenHint } from "./components/TokenHint";
import { ViewOpener } from "./layout/ViewOpener";
import { Workbench } from "./layout/Workbench";
import { subscribe, token } from "./token";
import { apiFit, builtFor } from "./version";

export function App() {
  const hasToken = useSyncExternalStore(subscribe, () => token() !== null);
  return hasToken ? <Shell /> : <TokenHint />;
}

/** The desktop shell: Groups of Panels between the version hint and the status bar. */
function Shell() {
  useObserveOnFocus();
  const info = useInfo();
  const fits = info.data ? apiFit(builtFor(), info.data.api) : null;
  return (
    <ViewOpener>
      <div className={styles.app}>
        {fits?.hint && (
          <p className={fits.usable ? styles.banner : styles.blocker} role="alert">
            {fits.hint}
          </p>
        )}
        <main className={styles.main}>{fits?.usable !== false && <Workbench />}</main>
        <StatusBar />
      </div>
    </ViewOpener>
  );
}
