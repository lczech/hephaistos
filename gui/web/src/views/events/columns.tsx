import {
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createColumnHelper,
  tableFeatures,
} from "@tanstack/react-table";
import { ChevronRight } from "lucide-react";
import type { Schemas } from "../../api/client";
import type { ColumnLook } from "../../components/table/columns";
import { actionIcon, actionOf, entityIcon } from "../../icons";
import { ago, fullTime } from "../../time";
import styles from "./EventsView.module.css";
import { machineText, repositoryText, subjectText } from "./eventText";

type Event = Schemas["EventJson"];

export const features = tableFeatures({
  columnVisibilityFeature,
  columnSizingFeature,
  columnResizingFeature,
  columnMeta: {} as ColumnLook,
  tableMeta: {} as { now: number; home: string | undefined },
});

/** Every column can be made as narrow as this, and gives way to it before the summary does. */
export const defaultColumn = { minSize: 40 };

const column = createColumnHelper<typeof features, Event>();

/** The Events list's columns; the summary takes the width the others leave. */
export const columns = column.columns([
  column.display({
    id: "priority", // a square, coloured for high and urgent priorities
    cell: () => <ChevronRight className={styles.chevron} aria-hidden="true" />,
    enableResizing: false,
    meta: { width: "var(--square)" },
  }),
  column.display({
    id: "recorded",
    header: "recorded",
    size: 72,
    cell: ({ row, table }) => (
      <span title={fullTime(row.original.recorded_at)}>
        {ago(row.original.recorded_at, table.options.meta?.now ?? Date.now())}
      </span>
    ),
  }),
  column.display({
    id: "kind",
    header: "kind",
    size: 140,
    cell: ({ row }) => {
      const action = actionOf(row.original.kind);
      const Action = actionIcon(action);
      return (
        <span title={row.original.kind}>
          <Action className={styles.icon} aria-hidden="true" />
          {action}
        </span>
      );
    },
  }),
  column.display({
    id: "repository",
    header: "repository",
    size: 120,
    cell: ({ row }) => repositoryText(row.original),
  }),
  column.display({
    id: "machine",
    header: "machine",
    size: 120,
    cell: ({ row }) => machineText(row.original),
  }),
  column.display({
    id: "subject",
    header: "subject",
    size: 200,
    cell: ({ row, table }) => {
      const event = row.original;
      // A Repository's own Events: its name is in the column before.
      if (event.subject.type === "repository") return "";
      const subject = subjectText(event, table.options.meta?.home);
      const Entity = entityIcon(event.subject.type);
      return (
        <span title={subject}>
          <Entity className={styles.icon} aria-hidden="true" />
          {subject}
        </span>
      );
    },
  }),
  column.display({
    id: "summary",
    header: "summary",
    cell: ({ row }) => <span title={row.original.summary}>{row.original.summary}</span>,
    enableResizing: false,
    meta: { width: "minmax(8rem, 1fr)" },
  }),
]);
