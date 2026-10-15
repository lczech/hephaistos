// How the Daemon is doing, in a word and why: what the status bar's icon shows.

import type { Schemas } from "../../api/client";

export type Health = "waiting" | "good" | "warning" | "lost";

/**
 * The Daemon's health: lost if its Server doesn't answer (`noAnswer`), else a warning for each
 * thing its status reports wrong, else good; waiting until it first answers.
 */
export function daemonHealth(
  answered: boolean,
  noAnswer: string | null,
  daemon: Schemas["DaemonJson"] | undefined,
): { health: Health; reasons: string[] } {
  if (noAnswer !== null) return { health: "lost", reasons: [`no answer: ${noAnswer}`] };
  if (!answered) return { health: "waiting", reasons: ["connecting…"] };
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
