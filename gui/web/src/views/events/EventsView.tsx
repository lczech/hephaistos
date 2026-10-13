import { useEffect, useRef } from "react";
import { useEvents } from "../../api/queries";
import { ago, fullTime } from "../../time";
import { useNow } from "../../useNow";
import styles from "./EventsView.module.css";
import { machineText, priorityName, subjectText } from "./eventText";

/** What happened, on any Machine, newest first: as `hephaistos event list` shows it. */
export function EventsView() {
  const events = useEvents();
  const now = useNow(10_000);
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
  return (
    <div className={styles.view} data-stale={events.isError || undefined}>
      <ol className={styles.events}>
        <li className={styles.head} aria-hidden="true">
          <span>recorded</span>
          <span>machine</span>
          <span>kind</span>
          <span>subject</span>
          <span>summary</span>
        </li>
        {listed.map((event) => {
          const priority = priorityName(event.priority);
          return (
            <li
              key={event.id}
              className={styles.event}
              data-priority={priority}
              title={`${priority} priority`}
            >
              <span title={fullTime(event.recorded_at)}>{ago(event.recorded_at, now)}</span>
              <span>{machineText(event)}</span>
              <span>{event.kind}</span>
              <span title={subjectText(event)}>{subjectText(event)}</span>
              <span className={styles.summary} title={event.summary}>
                {event.summary}
              </span>
            </li>
          );
        })}
      </ol>
      {hasNextPage && (
        <p ref={end} className={styles.quiet}>
          {isFetchingNextPage ? "Loading older Events…" : "Older Events load as you scroll."}
        </p>
      )}
    </div>
  );
}
