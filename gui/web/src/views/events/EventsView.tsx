import { useEffect, useRef, useState } from "react";
import { useEvents, useInfo, useMachines } from "../../api/queries";
import { useNow } from "../../useNow";
import { EventRow } from "./EventRow";
import styles from "./EventsView.module.css";

/** What happened, on any Machine, newest first: as `hephaistos event list` shows it. */
export function EventsView() {
  const events = useEvents();
  const home = useInfo().data?.home;
  const machines = useMachines().data?.length ?? 1;
  const now = useNow(10_000);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
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
  const listed = events.data.pages.flat();
  if (listed.length === 0) return <p className={styles.quiet}>No Events yet.</p>;
  const toggle = (id: string) =>
    setOpen((was) => {
      const next = new Set(was);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  // With one Machine, every Event names the same: its column only shows with several.
  const showMachine = machines > 1;
  return (
    <div className={styles.view} data-stale={events.isError || undefined}>
      <ol className={styles.events} data-machines={showMachine || undefined}>
        <li className={styles.head} aria-hidden="true">
          <span />
          <span>recorded</span>
          <span>kind</span>
          <span>repository</span>
          {showMachine && <span>machine</span>}
          <span>subject</span>
          <span>summary</span>
        </li>
        {listed.map((event) => (
          <EventRow
            key={event.id}
            event={event}
            now={now}
            home={home}
            showMachine={showMachine}
            open={open.has(event.id)}
            onToggle={() => toggle(event.id)}
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
