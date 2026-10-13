import { functionalUpdate, useTable } from "@tanstack/react-table";
import { FunnelX } from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import type { Schemas } from "../../api/client";
import { useEvents, useInfo, useMachines } from "../../api/queries";
import { ColumnHeader } from "../../components/table/ColumnHeader";
import { gridColumns } from "../../components/table/columns";
import { columnWidths } from "../../components/table/widths";
import { useNow } from "../../useNow";
import { columnFilters, filteredParams } from "../filters";
import type { ViewProps } from "../index";
import { eventFilters, eventsTitle, useEventChoices } from "./choices";
import { columns, defaultColumn, features } from "./columns";
import { EventRow } from "./EventRow";
import styles from "./EventsView.module.css";

const NONE: Schemas["EventJson"][] = [];

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
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const listed = useMemo(() => events.data?.pages.flat() ?? NONE, [events.data]);
  const filters = useMemo(() => columnFilters(columns, params), [params]);
  const table = useTable({
    features,
    columns,
    defaultColumn,
    data: listed,
    getRowId: (event) => event.id,
    atoms: { columnSizing: columnWidths("events") },
    // The Server filters: the filters are the View's parameters, and changing one changes those.
    manualFiltering: true,
    state: { columnVisibility: { machine: showMachine }, columnFilters: filters },
    onColumnFiltersChange: (change) =>
      setParams(filteredParams(columns, params, functionalUpdate(change, filters))),
    columnResizeMode: "onChange",
    meta: { now, home },
  });
  const choices = useEventChoices();
  const title = eventsTitle(filters, choices);
  useEffect(() => {
    if (title !== undefined) setTitle(title);
  }, [title, setTitle]);
  const end = useRef<HTMLParagraphElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = events;
  // Scrolling to the end of the list loads the page before it.
  useEffect(() => {
    if (end.current === null || !hasNextPage || isFetchingNextPage) return;
    const observer = new IntersectionObserver(([seen]) => {
      if (seen?.isIntersecting) void fetchNextPage();
    });
    observer.observe(end.current);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  const toggle = (id: string) =>
    setOpen((was) => {
      const next = new Set(was);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  let message: string | null = null;
  if (events.data === undefined) {
    message = events.isError ? `No answer: ${events.error.message}` : "Asking for Events…";
  } else if (listed.length === 0) {
    message = filters.length > 0 ? "No Events match." : "No Events yet.";
  }
  // Set by script, which the Content-Security-Policy allows, unlike style attributes in markup.
  const grid = { "--columns": gridColumns(table.getVisibleLeafColumns()) } as CSSProperties;
  return (
    <div
      className={styles.view}
      data-stale={events.isError || events.isPlaceholderData || undefined}
    >
      <div className={styles.events} style={grid}>
        <div className={styles.head}>
          {table
            .getHeaderGroups()
            .flatMap((group) => group.headers)
            .map((header) => {
              const label = header.column.columnDef.header;
              return (
                <ColumnHeader key={header.id} header={header} choices={choices[header.column.id]}>
                  {typeof label === "string" ? label : undefined}
                </ColumnHeader>
              );
            })}
          {filters.length > 0 && (
            <button
              type="button"
              className={styles.clear}
              onClick={() => table.resetColumnFilters(true)}
              title="Clear all filters"
              aria-label="Clear all filters"
            >
              <FunnelX aria-hidden="true" />
            </button>
          )}
        </div>
        {listed.length > 0 && (
          <ol className={styles.rows}>
            {table.getRowModel().rows.map((row) => (
              <EventRow
                key={row.id}
                row={row}
                now={now}
                home={home}
                open={open.has(row.id)}
                onToggle={() => toggle(row.id)}
              />
            ))}
          </ol>
        )}
      </div>
      {message !== null && <p className={styles.quiet}>{message}</p>}
      {hasNextPage && (
        <p ref={end} className={styles.quiet}>
          {isFetchingNextPage ? "Loading older Events…" : "Older Events load as you scroll."}
        </p>
      )}
    </div>
  );
}
