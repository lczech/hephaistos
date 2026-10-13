import { ChevronRight } from "lucide-react";
import type { Schemas } from "../../api/client";
import { actionIcon, actionOf, entityIcon } from "../../icons";
import { ago, fullTime } from "../../time";
import { EventDetails } from "./EventDetails";
import styles from "./EventsView.module.css";
import { machineText, priorityName, repositoryText, subjectText } from "./eventText";

interface Props {
  event: Schemas["EventJson"];
  now: number;
  home: string | undefined;
  showMachine: boolean;
  open: boolean;
  onToggle: () => void;
}

/** An Event in the list: a row that opens its details below it. */
export function EventRow({ event, now, home, showMachine, open, onToggle }: Props) {
  const priority = priorityName(event.priority);
  const action = actionOf(event.kind);
  const Action = actionIcon(action);
  const Entity = entityIcon(event.subject.type);
  // A Repository's own Events: its name is in the column before.
  const subject = event.subject.type === "repository" ? "" : subjectText(event, home);
  const details = `details-${event.id}`;
  return (
    <li className={styles.event} data-priority={priority}>
      <button
        type="button"
        className={styles.row}
        aria-expanded={open}
        aria-controls={open ? details : undefined}
        onClick={onToggle}
        title={`${priority} priority`}
      >
        <ChevronRight className={styles.chevron} aria-hidden="true" />
        <span className={styles.recorded} title={fullTime(event.recorded_at)}>
          {ago(event.recorded_at, now)}
        </span>
        <span className={styles.kind} title={event.kind}>
          <Action className={styles.icon} aria-hidden="true" />
          {action}
        </span>
        <span className={styles.repository}>{repositoryText(event)}</span>
        {showMachine && <span className={styles.machine}>{machineText(event)}</span>}
        <span className={styles.subject} title={subject}>
          {subject && <Entity className={styles.icon} aria-hidden="true" />}
          {subject}
        </span>
        <span className={styles.summary} title={event.summary}>
          {event.summary}
        </span>
      </button>
      {open && <EventDetails id={details} event={event} now={now} home={home} />}
    </li>
  );
}
