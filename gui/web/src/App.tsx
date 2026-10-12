import { useSyncExternalStore } from "react";
import styles from "./App.module.css";
import { useInfo, useObserveOnFocus } from "./api/queries";
import { Boundary } from "./components/Boundary";
import { DaemonCard } from "./components/DaemonCard";
import { StatusBar } from "./components/StatusBar";
import { TokenHint } from "./components/TokenHint";
import { subscribe, token } from "./token";
import { apiFit, builtFor } from "./version";

export function App() {
  const hasToken = useSyncExternalStore(subscribe, () => token() !== null);
  return hasToken ? <Workbench /> : <TokenHint />;
}

function Workbench() {
  useObserveOnFocus();
  const info = useInfo();
  const fits = info.data ? apiFit(builtFor(), info.data.api) : null;
  return (
    <div className={styles.app}>
      <main className={styles.main}>
        {fits?.hint && (
          <p className={fits.usable ? styles.banner : styles.blocker} role="alert">
            {fits.hint}
          </p>
        )}
        {fits?.usable !== false && (
          <Boundary hint={fits?.hint}>
            <DaemonCard />
          </Boundary>
        )}
      </main>
      <StatusBar />
    </div>
  );
}
