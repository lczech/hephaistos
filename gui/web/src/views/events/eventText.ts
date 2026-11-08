// Events as `hephaistos event list` shows them.

import type { Schemas } from "../../api/client";
import { shortPath } from "../../paths";
import { capitalised, nameOrId, shortId } from "../../text";

type Event = Schemas["EventJson"];

const PRIORITIES: Record<number, string> = { 10: "low", 20: "normal", 30: "high", 40: "urgent" };

/** A priority by name, or as a number if this version does not know it. */
export function priorityName(value: number): string {
  return PRIORITIES[value] ?? String(value);
}

/** The Event's subject: its name, its path (home as `~`), else its short ID. */
export function subjectText({ subject }: Event, home: string | undefined): string {
  if (subject.name !== null) return subject.name;
  return subject.path === null ? shortId(subject.id) : shortPath(subject.path, home);
}

/** The subject with its type, which its icon shows: `Worktree ~/Repos/heph/.worktrees/x`. */
export function subjectTitle(event: Event, home: string | undefined): string {
  const { type } = event.subject;
  return `${capitalised(type)} ${subjectText(event, home)}`;
}

/** The Repository of the Event's subject, if it has one: its name, else its short ID. */
export function repositoryText({ repository }: Event): string {
  return repository === null ? "" : nameOrId(repository);
}

/** The Machine that recorded the Event: its name, else its short ID. */
export function machineText({ recorded_by }: Event): string {
  return nameOrId(recorded_by);
}
