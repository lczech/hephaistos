// The lines of the Daemon card, worded as `hephaistos daemon status` words them.

import type { Schemas } from "../api/client";
import { ago, seconds, secondsUntil } from "../time";

type Process = Schemas["ProcessJson"];
type Pass = Schemas["PassJson"];
type Watcher = Schemas["WatcherJson"];
type Server = Schemas["ServerJson"];

export function daemonText(process: Process, now: number): string {
  if (process.running) {
    const how = process.under_systemd ? "running" : "running (not under systemd)";
    if (process.started_at === null) return how;
    return `${how}, pid ${process.pid}, started ${ago(process.started_at, now)}`;
  }
  if (process.stopped_at !== null) return `not running; stopped ${ago(process.stopped_at, now)}`;
  return "not running";
}

export function lastPassText(pass: Pass | null, now: number): string {
  if (pass === null) return "none yet";
  const by = pass.trigger === "watcher" ? "the Watcher" : "API request";
  const text = `${ago(pass.finished_at, now)} (${seconds(pass.duration)}), by ${by}`;
  return pass.error === null ? text : `${text}; failed: ${pass.error}`;
}

export function watcherText(watcher: Watcher | null, now: number): string {
  if (watcher === null) return "not running";
  if (watcher.interval === 0) return "passes only on request (watcher.interval is 0)";
  const text = `every ${seconds(watcher.interval)}`;
  if (watcher.last_pass === null) return `${text}; first pass running`;
  if (watcher.stalled)
    return `${text}; stalled: last pass ${ago(watcher.last_pass.finished_at, now)}`;
  const wait = watcher.next_pass_at === null ? 0 : secondsUntil(watcher.next_pass_at, now);
  return `${text}; next pass in ${wait} s`;
}

export function serverText(server: Server | null, now: number): string {
  if (server === null) return "not running";
  if (server.error !== null) return `failed: ${server.error}`;
  if (!server.listening) return "starting";
  let text = `listening on ${server.address}; `;
  if (server.last_request_at === null) text += "no requests yet";
  else {
    const requests = `${server.requests} ${server.requests === 1 ? "request" : "requests"}`;
    text += `${requests} since start, last ${ago(server.last_request_at, now)}`;
  }
  return server.refused > 0 ? `${text}; ${server.refused} refused` : text;
}
