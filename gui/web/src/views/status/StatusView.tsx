import { useQueryClient } from "@tanstack/react-query";
import { ClipboardCopy } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { Schemas } from "../../api/client";
import { type Connection, useConnection } from "../../api/live";
import { KEYS, useDaemon, useInfo, useObserve, useStatus } from "../../api/queries";
import { Quoted } from "../../components/Quoted";
import { TextIcon } from "../../components/TextIcon";
import { BarEnd, Refresh, ViewBar, ViewPage } from "../../components/ViewBar";
import { OUTCOME_ICONS } from "../../icons";
import { counted } from "../../text";
import { ago, fullTime } from "../../time";
import { useNow } from "../../useNow";
import { apiFit, builtFor } from "../../version";
import { loadErrorText } from "../CheckoutError";
import { useIsShown } from "../opening";
import { ViewLink } from "../ViewLink";
import { aboutRows, statusMarkdown } from "./about";
import { daemonText, lastPassText, serverText, watcherText } from "./daemonText";
import { retryText } from "./health";
import styles from "./StatusView.module.css";

type Lost = Extract<Connection, { state: "disconnected" }>;
type CheckJson = Schemas["CheckJson"];

/** What to check while the live connection is lost. */
function Disconnected({ connection, now }: { connection: Lost; now: number }) {
  const since = fullTime(connection.since);
  return (
    <div className={styles.notice} role="status">
      <p>
        No connection to the server of this machine since {since};{" "}
        {retryText(connection.retryAt, now)}.
      </p>
      <p>
        Is the daemon running? <code>hephaistos daemon status</code>; to start it:{" "}
        <code>hephaistos daemon start</code>
      </p>
    </div>
  );
}

/** The check of this GUI itself: whether it fits the API the Daemon runs. */
function guiCheck(api: Schemas["InfoJson"]["api"] | undefined): CheckJson | null {
  if (api === undefined) return null;
  const built = builtFor();
  const { hint } = apiFit(built, api);
  const text = `built for API ${built.major}.${built.minor}`;
  return hint === null
    ? { name: "gui", outcome: "ok", text, fix: null }
    : { name: "gui", outcome: "problem", text: hint, fix: null };
}

function Checks({ checks }: { checks: CheckJson[] }) {
  return (
    <ul className={styles.checks}>
      {checks.map((check, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a check may come twice, e.g. that of the unit
        <li key={i} className={styles.check} data-outcome={check.outcome}>
          <span className={styles.name}>
            <TextIcon icon={OUTCOME_ICONS[check.outcome]} label={check.outcome} /> {check.name}
          </span>
          <span>
            <Quoted text={check.text} />
            {check.fix !== null && (
              <span className={styles.fix}>
                {" "}
                → <Quoted text={check.fix} />
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Fields({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className={styles.fields}>
      {rows.map(([label, text]) => (
        <div key={label} className={styles.field}>
          <dt>{label}</dt>
          <dd>{text}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Copies `text`, saying so for a moment beside it, or why it could not, moving nothing. */
function CopyButton({ text, label, title }: { text: string; label: string; title: string }) {
  const [said, setSaid] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const say = (text: string) => {
    setSaid(text);
    // Each copy says so for its own moment, not cut short by the one before.
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaid(null), 3_000);
  };
  const copy = async () => {
    // Undefined outside a secure context, e.g. a page served over plain HTTP but not localhost.
    if (navigator.clipboard === undefined) return say("Not copied: this page has no clipboard");
    try {
      await navigator.clipboard.writeText(text);
      say("Copied");
    } catch (error) {
      say(`Not copied: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  return (
    <div className={styles.actions}>
      <button type="button" className={styles.action} onClick={copy} title={title}>
        <TextIcon icon={ClipboardCopy} />
        {label}
      </button>
      <span className={styles.quiet} role="status">
        {said}
      </span>
    </div>
  );
}

/** The warnings and errors of the last day in the log, linking to them; else to the whole log:
 * the link in the column of labels, what it shows in that of values. */
function LogCounts({ counts }: { counts: Schemas["LogCountsJson"] }) {
  const found = [
    ...(counts.errors > 0 ? [counted(counts.errors, "error")] : []),
    ...(counts.warnings > 0 ? [counted(counts.warnings, "warning")] : []),
  ];
  return (
    <>
      <span className={styles.link}>
        {found.length === 0 ? (
          <ViewLink address={{ kind: "log", params: {} }} label="The log" named />
        ) : (
          <ViewLink
            address={{ kind: "log", params: { level: "warning", since: "1d" } }}
            label="The log: warnings and errors of the last day"
            named
          />
        )}
      </span>
      <span>
        {found.length === 0 ? "No errors or warnings" : found.join(" and ")} in the last day
      </span>
    </>
  );
}

/** What About and Log show while the setup is not there: checking, or why it failed. */
function Waiting({ failed }: { failed: boolean }) {
  return <p className={styles.quiet}>{failed ? "Not loaded; see Setup" : "Loading…"}</p>;
}

const ADDRESS = { kind: "status", params: {} };

/**
 * The setup of this Machine, its Daemon, and what runs, as `hephaistos status` shows them: the
 * setup as the Daemon checks it while this shows, and how the Daemon is doing, kept current by
 * live hints. Refresh also asks for a pass, which the last pass shows.
 */
export function StatusView() {
  const status = useStatus(useIsShown()(ADDRESS));
  const daemon = useDaemon();
  const info = useInfo();
  const client = useQueryClient();
  const observing = useObserve();
  const connection = useConnection();
  const now = useNow();
  const stale = connection.state === "disconnected" || status.isError || daemon.isError;
  const own = guiCheck(info.data?.api);
  const checks = [...(status.data?.checks ?? []), ...(own === null ? [] : [own])];
  // Running all from one answer: that of `/api/daemon`, kept current, else the one in the setup.
  const running = daemon.data ?? status.data?.daemon;
  const process = running?.daemon;
  const log =
    process?.pid !== null && process?.pid !== undefined ? (
      <ViewLink
        address={{ kind: "log", params: { process: "daemon", pid: String(process.pid) } }}
        label="The log of the daemon"
        named
      />
    ) : null;
  const watcher = running?.watcher ?? null;
  const about =
    status.data && process
      ? aboutRows(status.data.about, process, builtFor(), navigator.userAgent)
      : null;
  const refresh = () => {
    void client.invalidateQueries({ queryKey: KEYS.status });
    observing.mutate();
  };
  return (
    <ViewPage>
      <ViewBar>
        <BarEnd>
          {status.data !== undefined && <span>checked {ago(status.dataUpdatedAt, now)}</span>}
          <Refresh busy={status.isFetching || observing.isPending} onClick={refresh} />
        </BarEnd>
      </ViewBar>
      <section className={styles.view}>
        {connection.state === "disconnected" && <Disconnected connection={connection} now={now} />}
        <div className={styles.status} data-stale={stale || undefined}>
          <h2 className={styles.heading}>Setup</h2>
          {status.data === undefined && (
            <p className={status.isError ? styles.problem : styles.quiet}>
              {status.isError ? loadErrorText(status.error) : "Checking…"}
            </p>
          )}
          <Checks checks={checks} />

          <h2 className={styles.heading}>About</h2>
          {about === null ? (
            <Waiting failed={status.isError} />
          ) : (
            <>
              <Fields rows={about} />
              <CopyButton
                text={statusMarkdown(checks, about, info.data?.home)}
                label="Copy Setup and About"
                title="Copy Setup and About as Markdown"
              />
            </>
          )}

          <h2 className={styles.heading}>Running</h2>
          {process === undefined ? (
            <p className={daemon.isError ? styles.problem : styles.quiet}>
              {daemon.isError ? loadErrorText(daemon.error) : "Loading the status of the daemon…"}
            </p>
          ) : (
            <Fields
              rows={[
                [
                  "Daemon",
                  <>
                    {daemonText(process, now)} {log}
                  </>,
                ],
                ["Last pass", lastPassText(watcher?.last_pass ?? null, now)],
                ["Watcher", watcherText(watcher, now)],
                ["Server", serverText(running?.server ?? null, now)],
              ]}
            />
          )}
          {observing.isError && <p className={styles.error}>{observing.error.message}</p>}

          <h2 className={styles.heading}>Log</h2>
          {status.data === undefined ? (
            <Waiting failed={status.isError} />
          ) : (
            <LogCounts counts={status.data.log} />
          )}
        </div>
      </section>
    </ViewPage>
  );
}
