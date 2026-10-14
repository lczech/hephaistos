// What the Events list's filters offer, and what the filters set say in the tab's title.

import type { ColumnFiltersState } from "@tanstack/react-table";
import type { EventFilters } from "../../api/queries";
import { useEventKinds, useMachines, useRepositories } from "../../api/queries";
import type { Choice } from "../../components/table/filters";
import { type Params, paramValues } from "../address";
import { filteredTitle, SINCE } from "../filters";
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

const PRIORITIES: Choice[] = [
  { value: "normal", label: "normal+" },
  { value: "high", label: "high+" },
  { value: "urgent", label: "urgent" },
];

/** Kinds by what they are about: `clone` is within reach of `clone.added` and its others. */
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
export function useEventChoices(): Record<string, Choice[] | undefined> {
  const kinds = useEventKinds().data;
  const repositories = useRepositories().data;
  const machines = useMachines().data;
  return {
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
