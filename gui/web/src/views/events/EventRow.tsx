import { FlexRender, type Row } from "@tanstack/react-table";
import type { Schemas } from "../../api/client";
import type { features } from "./columns";
import { EventDetails } from "./EventDetails";
import styles from "./EventsView.module.css";
import { priorityName } from "./eventText";

interface Props {
  row: Row<typeof features, Schemas["EventJson"]>;
  now: number;
  home: string | undefined;
  open: boolean;
  onToggle: () => void;
}

/** An Event in the list: a row that opens its details below it. */
export function EventRow({ row, now, home, open, onToggle }: Props) {
  const event = row.original;
  const priority = priorityName(event.priority);
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
        {row.getVisibleCells().map((cell) => (
          <span key={cell.id} data-column={cell.column.id}>
            <FlexRender cell={cell} />
          </span>
        ))}
      </button>
      {open && <EventDetails id={details} event={event} now={now} home={home} />}
    </li>
  );
}
