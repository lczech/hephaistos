import type { Schemas } from "../../api/client";
import { ago, fullTime } from "../../time";
import styles from "./EventsView.module.css";
import { machineText, priorityName, repositoryText, subjectText } from "./eventText";

interface Props {
  id: string;
  event: Schemas["EventJson"];
  now: number;
  home: string | undefined;
}

/** Everything about an Event, as `hephaistos event show` shows it. */
export function EventDetails({ id, event, now, home }: Props) {
  const when = (at: string | null) => (at === null ? "-" : `${fullTime(at)} (${ago(at, now)})`);
  const fields: [string, string][] = [
    ["id", event.id],
    ["recorded", when(event.recorded_at)],
    ["occurred", when(event.occurred_at)],
    ["priority", priorityName(event.priority)],
    ["kind", event.kind],
    ["repository", repositoryText(event) || "-"],
    ["machine", machineText(event)],
    ["subject", subjectText(event, home)],
    ["subject id", event.subject.id],
  ];
  return (
    <section id={id} className={styles.details} aria-label="Event details">
      <dl className={styles.fields}>
        {fields.map(([label, text]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{text}</dd>
          </div>
        ))}
      </dl>
      {event.details.length > 0 && (
        <>
          <p className={styles.payload}>payload</p>
          <dl className={styles.fields}>
            {event.details.map(({ field, text }) => (
              <div key={field}>
                <dt>{field}</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  );
}
