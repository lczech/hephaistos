// What the Events list's filters offer, and what the filters set say in the tab's title.

import type { ColumnFiltersState } from "@tanstack/react-table";
import type { Schemas } from "../../api/client";
import type { EventFilters } from "../../api/queries";
import { useEventKinds, useInfo, useMachines, useRepositories } from "../../api/queries";
import type { Choice } from "../../components/table/filters";
import { shortPath } from "../../paths";
import { type Params, paramValues, withParam } from "../address";
import { columnFilters, filteredParams, filteredTitle, SINCE } from "../filters";
import { columns } from "./columns";

/** The filters in these parameters, as `/api/events` takes them. */
export function eventFilters(params: Params): EventFilters {
  const one = (name: string) => paramValues(params[name])[0];
  const any = (name: string) =>
    params[name] === undefined ? undefined : paramValues(params[name]);
  return {
    kind: any("kind"),
    priority: one("priority") as EventFilters["priority"], // the Server refuses any other
    machine: any("machine"),
    since: one("since"),
    repository: any("repository"),
    clone: one("clone"),
    worktree: one("worktree"),
  };
}

// The subject column's filter, set by links to a Checkout's Events: `clone:…` or `worktree:…`.
const SUBJECTS = ["clone", "worktree"] as const;

function oneSubject(params: Params): string | undefined {
  for (const type of SUBJECTS) {
    const [id] = paramValues(params[type]);
    if (id !== undefined) return `${type}:${id}`;
  }
  return undefined;
}

/** The filters these parameters set; a Clone or Worktree, in the subject column's. */
export function eventColumnFilters(params: Params): ColumnFiltersState {
  const subject = oneSubject(params);
  return columnFilters(columns, subject === undefined ? params : { ...params, subject });
}

/** The parameters with only these filters set: a subject as its type and ID. */
export function eventParams(params: Params, filters: ColumnFiltersState): Params {
  let changed = filteredParams(columns, params, filters);
  const [type, id] = paramValues(changed.subject)[0]?.split(":") ?? [];
  changed = withParam(changed, "subject", []);
  for (const each of SUBJECTS) {
    changed = withParam(changed, each, each === type && id !== undefined ? [id] : []);
  }
  return changed;
}

/** The Clone or Worktree a subject filter names, by its path; none until the paths are known. */
function subjectChoices(
  subject: string | undefined,
  repositories: Schemas["RepositoryJson"][] | undefined,
  home: string | undefined,
): Choice[] | undefined {
  if (subject === undefined) return [];
  if (repositories === undefined) return undefined;
  for (const clone of repositories.flatMap((repository) => repository.clones)) {
    for (const checkout of [clone, ...clone.worktrees]) {
      const type = checkout === clone ? "clone" : "worktree";
      if (`${type}:${checkout.id}` === subject) {
        return [{ value: subject, label: shortPath(checkout.path, home) }];
      }
    }
  }
  return [{ value: subject, label: subject }]; // removed meanwhile
}

const PRIORITIES: Choice[] = [
  { value: "normal", label: "normal+" },
  { value: "high", label: "high+" },
  { value: "urgent", label: "urgent" },
];

/** Kinds by what they are about: `clone` is within reach of `clone.registered` and its others. */
function kindChoices(kinds: string[]): Choice[] {
  const groups = new Map<string, Choice[]>();
  for (const kind of kinds) {
    const [about = kind] = kind.split(".");
    groups.set(about, [...(groups.get(about) ?? []), { value: kind, label: kind }]);
  }
  return [...groups].map(([about, choices]) => ({ value: about, label: about, choices }));
}

function named(found: { id: string; name: string }[]): Choice[] {
  return found.map(({ id, name }) => ({ value: id, label: name }));
}

/** Each filtering column's choices; none yet for those still asked for. */
export function useEventChoices(params: Params): Record<string, Choice[] | undefined> {
  const kinds = useEventKinds().data;
  const repositories = useRepositories().data;
  const machines = useMachines().data;
  const home = useInfo().data?.home;
  return {
    subject: subjectChoices(oneSubject(params), repositories, home),
    priority: PRIORITIES,
    recorded: SINCE,
    kind: kinds && kindChoices(kinds.map(({ kind }) => kind)),
    repository: repositories && named(repositories),
    machine: machines && named(machines),
  };
}

/** The tab's title for these filters: `Events: last day, project`. */
export function eventsTitle(
  filters: ColumnFiltersState,
  choices: Record<string, Choice[] | undefined>,
): string | undefined {
  return filteredTitle("Events", columns, filters, choices);
}
