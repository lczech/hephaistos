// How the Daemon is doing, in a word and why: what the status bar's icon shows.

import type { Schemas } from "../../api/client";
import type { Connection } from "../../api/live";
import { ago } from "../../time";

export type Health = "waiting" | "good" | "warning" | "lost";

/**
 * The Daemon's health: lost while the live connection is, waiting until it first connects, else
 * a warning for each thing its status reports wrong, else good.
 */
export function daemonHealth(
  connection: Connection,
  daemon: Schemas["DaemonJson"] | undefined,
  now: number,
): { health: Health; reasons: string[] } {
  if (connection.state === "connecting") return { health: "waiting", reasons: ["connecting…"] };
  if (connection.state === "disconnected") {
    return { health: "lost", reasons: [disconnectedText(connection.since, now)] };
  }
  if (daemon === undefined) return { health: "good", reasons: ["running"] };
  const { watcher, server, warnings } = daemon;
  const reasons = [...warnings];
  if (watcher?.last_pass?.error) reasons.push(`last pass failed: ${watcher.last_pass.error}`);
  if (watcher?.stalled) reasons.push("the Watcher has stalled");
  if (server?.error) reasons.push(`the Server failed: ${server.error}`);
  return reasons.length > 0
    ? { health: "warning", reasons }
    : { health: "good", reasons: ["running"] };
}

/** When the live connection is tried again, e.g. `trying again in 8 s`. */
export function retryText(retryAt: number, now: number): string {
  const seconds = Math.ceil((retryAt - now) / 1000);
  return seconds > 0 ? `trying again in ${seconds} s` : "trying again";
}

/** How long the live connection has been lost, e.g. `disconnected 3m ago`. */
export function disconnectedText(since: number, now: number): string {
  const when = ago(since, now);
  return when === "now" ? "disconnected" : `disconnected ${when}`;
}
