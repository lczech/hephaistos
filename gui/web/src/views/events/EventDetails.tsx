import type { Schemas } from "../../api/client";
import { Fields } from "../../components/table/Fields";
import { ago, fullTime } from "../../time";
import { machineText, priorityName, repositoryText, subjectText } from "./eventText";

interface Props {
  event: Schemas["EventJson"];
  now: number;
  home: string | undefined;
}

/** Everything about an Event, as `hephaistos event show` shows it. */
export function EventDetails({ event, now, home }: Props) {
  const when = (at: string | null) => (at === null ? "-" : `${fullTime(at)} (${ago(at, now)})`);
  return (
    <>
      <Fields
        fields={[
          ["id", event.id],
          ["recorded", when(event.recorded_at)],
          ["occurred", when(event.occurred_at)],
          ["priority", priorityName(event.priority)],
          ["kind", event.kind],
          ["repository", repositoryText(event) || "-"],
          ["machine", machineText(event)],
          ["subject", subjectText(event, home)],
          ["subject id", event.subject.id],
        ]}
      />
      {event.details.length > 0 && (
        <Fields title="payload" fields={event.details.map(({ field, text }) => [field, text])} />
      )}
    </>
  );
}
