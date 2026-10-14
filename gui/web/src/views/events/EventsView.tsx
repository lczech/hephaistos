import { functionalUpdate } from "@tanstack/react-table";
import { useEffect, useMemo } from "react";
import type { Schemas } from "../../api/client";
import { useEvents, useInfo, useMachines } from "../../api/queries";
import { ListTable, type Tone } from "../../components/table/ListTable";
import { useListTable } from "../../components/table/list";
import { columnWidths } from "../../components/table/widths";
import { useNow } from "../../useNow";
import { columnFilters, filteredParams } from "../filters";
import type { ViewProps } from "../index";
import { eventFilters, eventsTitle, useEventChoices } from "./choices";
import { columns } from "./columns";
import { EventDetails } from "./EventDetails";
import styles from "./EventsView.module.css";
import { priorityName } from "./eventText";

type Event = Schemas["EventJson"];

const NONE: Event[] = [];

const TONES: Record<string, Tone> = { low: "muted", high: "warning", urgent: "danger" };

/**
 * What happened, on any Machine, newest first: as `hephaistos event list` shows it, filtered
 * by its parameters as that is by its options.
 */
export function EventsView({ params, setParams, setTitle }: ViewProps) {
  const events = useEvents(eventFilters(params));
  const home = useInfo().data?.home;
  // With one Machine, every Event names the same: its column only shows with several.
  const showMachine = (useMachines().data?.length ?? 1) > 1;
  const now = useNow(10_000);
  const listed = useMemo(() => events.data?.pages.flat() ?? NONE, [events.data]);
  const filters = useMemo(() => columnFilters(columns, params), [params]);
  const table = useListTable({
    columns,
    data: listed,
    getRowId: (event) => event.id,
    atoms: { columnSizing: columnWidths("events") },
    // The Server filters: the filters are the View's parameters, and changing one changes those.
    manualFiltering: true,
    state: { columnVisibility: { machine: showMachine }, columnFilters: filters },
    onColumnFiltersChange: (change) =>
      setParams(filteredParams(columns, params, functionalUpdate(change, filters))),
    meta: { now, home },
  });
  const choices = useEventChoices();
  const title = eventsTitle(filters, choices);
  useEffect(() => {
    if (title !== undefined) setTitle(title);
  }, [title, setTitle]);
  let message: string | null = null;
  if (events.data === undefined) {
    message = events.isError ? `No answer: ${events.error.message}` : "Asking for Events…";
  } else if (listed.length === 0) {
    message = filters.length > 0 ? "No Events match." : "No Events yet.";
  }
  return (
    <ListTable
      table={table}
      className={styles.events}
      choices={choices}
      message={message}
      stale={events.isError || events.isPlaceholderData}
      paging={events}
      older="Events"
      tone={(event) => TONES[priorityName(event.priority)]}
      rowTitle={(event) => `${priorityName(event.priority)} priority`}
      detailsLabel="Event details"
      details={(event) => <EventDetails event={event} now={now} home={home} />}
    />
  );
}
