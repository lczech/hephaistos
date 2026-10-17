import type { Schemas } from "../../api/client";
import { Fields, Titled } from "../../components/table/Fields";
import { ago, fullTime } from "../../time";
import type { Checkout } from "../changes/checkout";
import { CommitBox, type KnownCommit } from "../history/CommitBox";
import { machineText, priorityName, repositoryText, subjectText } from "./eventText";

type Event = Schemas["EventJson"];

interface Props {
  event: Event;
  now: number;
  home: string | undefined;
}

/** Everything about an Event, as `hephaistos event show` shows it; a commit's, all about it. */
export function EventDetails({ event, now, home }: Props) {
  const when = (at: string | null) => (at === null ? "-" : `${fullTime(at)} (${ago(at, now)})`);
  const committed = committedOf(event);
  // The commit's box says its message whole.
  const details = event.details.filter(({ field }) => !(committed && field === "body"));
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
      {details.length > 0 && (
        <Fields title="payload" fields={details.map(({ field, text }) => [field, text])} />
      )}
      {committed && (
        <Titled title="commit">
          <CommitBox commit={committed.commit} checkout={committed.checkout} now={now} heading />
        </Titled>
      )}
    </>
  );
}

/** A commit Event's commit, as its payload has it, and the Checkout it was made in. */
function committedOf(event: Event): { commit: KnownCommit; checkout: Checkout } | undefined {
  if (!event.kind.endsWith(".committed")) return undefined;
  const { head, subject, body } = event.payload as {
    head?: { new?: unknown };
    subject?: unknown;
    body?: unknown;
  };
  if (typeof head?.new !== "string" || typeof subject !== "string") return undefined;
  const { type, id } = event.subject;
  if (type !== "clone" && type !== "worktree") return undefined;
  const checkout: Checkout = type === "clone" ? { clone: id } : { worktree: id };
  return {
    commit: { hash: head.new, subject, body: typeof body === "string" ? body : "" },
    checkout,
  };
}
