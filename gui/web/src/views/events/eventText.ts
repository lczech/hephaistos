// Events as `hephaistos event list` shows them.

import type { Schemas } from "../../api/client";
import { shortPath } from "../../paths";

type Event = Schemas["EventJson"];

const PRIORITIES: Record<number, string> = { 10: "low", 20: "normal", 30: "high", 40: "urgent" };

/** A priority by name, or as a number if this version doesn't know it. */
export function priorityName(value: number): string {
  return PRIORITIES[value] ?? String(value);
}

/** The end of an ID, as the CLI shows it in lists. */
export function shortId(id: string): string {
  return id.replaceAll("-", "").slice(-8);
}

/** The Event's subject: its name, its path (home as `~`), else its short ID. */
export function subjectText({ subject }: Event, home: string | undefined): string {
  if (subject.name !== null) return subject.name;
  return subject.path === null ? shortId(subject.id) : shortPath(subject.path, home);
}

/** The Repository of the Event's subject, if it has one: its name, else its short ID. */
export function repositoryText({ repository }: Event): string {
  return repository === null ? "" : (repository.name ?? shortId(repository.id));
}

/** The Machine that recorded the Event: its name, else its short ID. */
export function machineText({ recorded_by }: Event): string {
  return recorded_by.name ?? shortId(recorded_by.id);
}
