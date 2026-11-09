import { functionalUpdate } from "@tanstack/react-table";
import type { Schemas } from "../../api/client";
import { useEvents, useInfo, useMachines } from "../../api/queries";
import { useListLayout } from "../../components/list/kept";
import { LayoutToggle } from "../../components/list/LayoutToggle";
import { List, type Tone } from "../../components/list/List";
import { useList } from "../../components/list/table";
import { BarEnd, BarGroup, ViewBar, ViewPage } from "../../components/ViewBar";
import { useNow } from "../../useNow";
import { loadErrorText } from "../CheckoutError";
import type { ViewProps } from "../index";
import { useTitle } from "../title";
import {
  eventColumnFilters,
  eventFilters,
  eventParams,
  eventsTitle,
  useEventChoices,
} from "./choices";
import { columns, oneMachineColumns } from "./columns";
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
  const listed = events.data?.pages.flat() ?? NONE;
  const filters = eventColumnFilters(params);
  const [layout, setLayout] = useListLayout("events");
  const table = useList("events", layout, {
    columns: showMachine ? columns : oneMachineColumns,
    data: listed,
    getRowId: (event) => event.id,
    // The Server filters: the filters are the View's parameters, and changing one changes those.
    manualFiltering: true,
    state: { columnFilters: filters },
    onColumnFiltersChange: (change) =>
      setParams(eventParams(params, functionalUpdate(change, filters))),
    meta: { now, home },
  });
  const choices = useEventChoices(params);
  const title = eventsTitle(filters, choices);
  useTitle(setTitle, title);
  let message: string | null = null;
  if (events.data === undefined) {
    message = events.isError ? loadErrorText(events.error) : "Loading events…";
  } else if (listed.length === 0) {
    message = filters.length > 0 ? "No events match." : "No events yet.";
  }
  return (
    <ViewPage>
      <ViewBar>
        <BarEnd>
          <BarGroup>
            <LayoutToggle layout={layout} onChange={setLayout} />
          </BarGroup>
        </BarEnd>
      </ViewBar>
      <List
        table={table}
        className={styles.events}
        layout={layout}
        choices={choices}
        message={message}
        problem={events.data === undefined && events.isError}
        stale={events.isError || events.isPlaceholderData}
        paging={events}
        older="events"
        tone={(event) => TONES[priorityName(event.priority)]}
        squareTitle={(event) => `${priorityName(event.priority)} priority`}
        detailsLabel="Event details"
        details={(event) => <EventDetails event={event} now={now} home={home} />}
      />
    </ViewPage>
  );
}
