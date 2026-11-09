import { useSyncExternalStore } from "react";
import styles from "./App.module.css";
import { useLiveUpdates } from "./api/live";
import { useInfo, useSetting } from "./api/queries";
import { TimeFormatContext, timeFormatOf } from "./components/Ago";
import { StatusBar } from "./components/StatusBar";
import { TitleBar } from "./components/TitleBar";
import { TokenHint } from "./components/TokenHint";
import { ViewOpener } from "./layout/ViewOpener";
import { Workbench } from "./layout/Workbench";
import { useLook } from "./look";
import { useTheme } from "./theme";
import { subscribe, token } from "./token";
import { apiFit, builtFor } from "./version";

export function App() {
  const hasToken = useSyncExternalStore(subscribe, () => token() !== null);
  return hasToken ? <Shell /> : <TokenHint />;
}

/** The desktop shell: Groups of Panels between the version hint and the status bar. */
function Shell() {
  useLiveUpdates();
  useLook();
  useTheme();
  const info = useInfo();
  const times = timeFormatOf(useSetting("time_format"));
  const fits = info.data ? apiFit(builtFor(), info.data.api) : null;
  return (
    <TimeFormatContext value={times}>
      <ViewOpener>
        <div className={styles.app}>
          <TitleBar />
          {fits?.hint && (
            <p className={fits.usable ? styles.banner : styles.blocker} role="alert">
              {fits.hint}
            </p>
          )}
          <main className={styles.main}>{fits?.usable !== false && <Workbench />}</main>
          <StatusBar />
        </div>
      </ViewOpener>
    </TimeFormatContext>
  );
}
