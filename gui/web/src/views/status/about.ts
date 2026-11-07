// The Status View's About: what runs and on what, as rows; with Setup, as Markdown to paste.

import type { Schemas } from "../../api/client";
import { fullTime } from "../../time";
import type { ApiVersion } from "../../version";

type About = Schemas["AboutJson"];
type Process = Schemas["ProcessJson"];
type CheckJson = Schemas["CheckJson"];

/** What shows this GUI, from its user agent: Electron's and Chromium's versions, else the browser. */
export function shellText(userAgent: string): string {
  const electron = /Electron\/(\S+)/.exec(userAgent)?.[1];
  const chromium = /Chrome\/(\S+)/.exec(userAgent)?.[1];
  if (electron === undefined) return userAgent;
  return chromium === undefined
    ? `Electron ${electron}`
    : `Electron ${electron}, Chromium ${chromium}`;
}

function runningText(process: Process): string {
  if (!process.running) return "not running";
  const how = process.under_systemd ? "under systemd" : "not under systemd";
  const since = process.started_at === null ? "" : `, since ${fullTime(process.started_at)}`;
  return `running ${how}, pid ${process.pid}${since}`;
}

const known = (value: string | null) => value ?? "unknown";

/** The rows of About: the Daemon's findings, how it runs, and what this GUI was built for. */
export function aboutRows(
  about: About,
  process: Process,
  built: ApiVersion,
  userAgent: string,
): [string, string][] {
  return [
    ["hephaistos", about.version],
    ["API", `${about.api}; the GUI was built for ${built.major}.${built.minor}`],
    ["Schema", String(about.schema)],
    ["Daemon", runningText(process)],
    ["Python", about.python],
    ["SQLite", about.sqlite],
    ["git", known(about.git)],
    ["tmux", known(about.tmux)],
    ["systemd", known(about.systemd)],
    ["OS", known(about.os)],
    ["Kernel", `Linux ${about.kernel}`],
    ["Desktop", known(about.desktop)],
    ["Locale", known(about.locale)],
    ["Time zone", known(about.time_zone)],
    ["GUI", shellText(userAgent)],
  ];
}

/**
 * Setup and About as Markdown, every check included; `home`, which names the user, as `~`.
 */
export function statusMarkdown(
  checks: CheckJson[],
  rows: [string, string][],
  home: string | undefined,
): string {
  const lines = [
    "**hephaistos status**",
    "",
    "Setup:",
    ...checks.map((check) => `- ${check.name} (${check.outcome}): ${check.text}`),
    "",
    "About:",
    ...rows.map(([label, value]) => `- ${label}: ${value}`),
  ];
  const text = `${lines.join("\n")}\n`;
  return home === undefined || home === "/" ? text : text.replaceAll(home, "~");
}
