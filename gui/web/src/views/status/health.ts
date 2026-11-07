// How this Machine's setup and Daemon are doing, in a word and why: what the Status View's icon
// shows, in the status bar and its tab.

import type { Schemas } from "../../api/client";
import { type Connection, useConnection } from "../../api/live";
import { useDaemon, useInfo } from "../../api/queries";
import { ago, seconds, secondsUntil } from "../../time";
import { useNow } from "../../useNow";
import { apiFit, builtFor } from "../../version";

export type Health = "waiting" | "good" | "warning" | "lost";

/**
 * The health: lost while the live connection is, waiting until it first connects, else a
 * warning for each problem with the setup, as the Daemon checked it last, with this GUI's fit
 * (`apiHint`), and with how the Daemon runs; else good.
 */
export function daemonHealth(
  connection: Connection,
  daemon: Schemas["DaemonJson"] | undefined,
  now: number,
  apiHint: string | null = null,
): { health: Health; reasons: string[] } {
  if (connection.state === "connecting") return { health: "waiting", reasons: ["connecting…"] };
  if (connection.state === "disconnected") {
    return { health: "lost", reasons: [disconnectedText(connection.since, now)] };
  }
  const reasons = apiHint === null ? [] : [apiHint];
  if (daemon !== undefined) {
    const { watcher, server } = daemon;
    reasons.push(...setupProblems(daemon));
    if (watcher?.last_pass?.error) reasons.push(`last pass failed: ${watcher.last_pass.error}`);
    for (const problem of watcher?.last_pass?.problems ?? []) reasons.push(`last pass: ${problem}`);
    if (watcher?.stalled) reasons.push("the watcher has stalled");
    if (server?.error) reasons.push(`the server failed: ${server.error}`);
  }
  return reasons.length > 0
    ? { health: "warning", reasons }
    : { health: "good", reasons: ["running"] };
}

/** This Machine's health, kept current: by the live connection, and the Daemon's status. */
export function useHealth(): { health: Health; reasons: string[] } {
  const info = useInfo();
  const daemon = useDaemon();
  const connection = useConnection();
  const now = useNow();
  const hint = info.data ? apiFit(builtFor(), info.data.api).hint : null;
  return daemonHealth(connection, daemon.data, now, hint);
}

/** The problems the Daemon's checks of the setup found, as it ran them last. */
export function setupProblems(daemon: Schemas["DaemonJson"]): string[] {
  const checks = daemon.checks?.checks ?? [];
  return checks
    .filter((check) => check.outcome === "problem")
    .map((check) => `${check.name}: ${check.text}`);
}

/** When the live connection is tried again, e.g. `trying again in 8 s`. */
export function retryText(retryAt: number, now: number): string {
  const wait = secondsUntil(retryAt, now);
  return wait > 0 ? `trying again in ${seconds(wait)}` : "trying again";
}

/** How long the live connection has been lost, e.g. `disconnected 3m ago`. */
export function disconnectedText(since: number, now: number): string {
  const when = ago(since, now);
  return when === "now" ? "disconnected" : `disconnected ${when}`;
}
