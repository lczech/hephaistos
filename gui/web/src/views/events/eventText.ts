// Events as `hephaistos event list` shows them.

import type { Schemas } from "../../api/client";

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

/** The Event's subject: its name or path, else its short ID. */
export function subjectText({ subject }: Event): string {
  return subject.name ?? subject.path ?? shortId(subject.id);
}

/** The Machine that recorded the Event: its name, else its short ID. */
export function machineText({ recorded_by }: Event): string {
  return recorded_by.name ?? shortId(recorded_by.id);
}
