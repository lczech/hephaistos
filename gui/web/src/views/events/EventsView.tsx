import { FlexRender, useTable } from "@tanstack/react-table";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import type { Schemas } from "../../api/client";
import { useEvents, useInfo, useMachines } from "../../api/queries";
import { gridColumns, Resizer } from "../../components/table/columns";
import { columnWidths } from "../../components/table/widths";
import { useNow } from "../../useNow";
import { columns, defaultColumn, features } from "./columns";
import { EventRow } from "./EventRow";
import styles from "./EventsView.module.css";

const NONE: Schemas["EventJson"][] = [];

/** What happened, on any Machine, newest first: as `hephaistos event list` shows it. */
export function EventsView() {
  const events = useEvents();
  const home = useInfo().data?.home;
  // With one Machine, every Event names the same: its column only shows with several.
  const showMachine = (useMachines().data?.length ?? 1) > 1;
  const now = useNow(10_000);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const listed = useMemo(() => events.data?.pages.flat() ?? NONE, [events.data]);
  const table = useTable({
    features,
    columns,
    defaultColumn,
    data: listed,
    getRowId: (event) => event.id,
    atoms: { columnSizing: columnWidths("events") },
    state: { columnVisibility: { machine: showMachine } },
    columnResizeMode: "onChange",
    meta: { now, home },
  });
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
  if (events.data === undefined) {
    const text = events.isError ? `No answer: ${events.error.message}` : "Asking for Events…";
    return <p className={styles.quiet}>{text}</p>;
  }
  if (listed.length === 0) return <p className={styles.quiet}>No Events yet.</p>;
  const toggle = (id: string) =>
    setOpen((was) => {
      const next = new Set(was);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  // Set by script, which the Content-Security-Policy allows, unlike style attributes in markup.
  const grid = { "--columns": gridColumns(table.getVisibleLeafColumns()) } as CSSProperties;
  return (
    <div className={styles.view} data-stale={events.isError || undefined}>
      <ol className={styles.events} style={grid}>
        <li className={styles.head} aria-hidden="true">
          {table
            .getHeaderGroups()
            .flatMap((group) => group.headers)
            .map((header) => (
              <span key={header.id} data-column={header.column.id}>
                <span className={styles.label}>
                  <FlexRender header={header} />
                </span>
                {header.column.getCanResize() && <Resizer header={header} />}
              </span>
            ))}
        </li>
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
      {hasNextPage && (
        <p ref={end} className={styles.quiet}>
          {isFetchingNextPage ? "Loading older Events…" : "Older Events load as you scroll."}
        </p>
      )}
    </div>
  );
}
