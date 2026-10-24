import type { Schemas } from "../../api/client";
import { TextIcon } from "../../components/TextIcon";
import { Chevron } from "../../components/table/ListTable";
import { listColumnHelper } from "../../components/table/list";
import { actionOf, entityIcon, kindIcon } from "../../icons";
import { ago, fullTime } from "../../time";
import styles from "./EventsView.module.css";
import { machineText, repositoryText, subjectText, subjectTitle } from "./eventText";

type Event = Schemas["EventJson"];

const column = listColumnHelper<Event>();

/**
 * The Events list's columns. Their filters are those of `/api/events`, by the same names.
 */
export const columns = column.columns([
  column.display({
    id: "priority", // a square, coloured for high and urgent priorities
    cell: Chevron,
    enableResizing: false,
    meta: { width: "var(--square)", filter: { param: "priority" } },
  }),
  column.display({
    id: "recorded",
    header: "recorded",
    size: 88,
    meta: {
      filter: { param: "since" },
      description: "When the Event was recorded; its details show when it happened, if known",
    },
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
    meta: { filter: { param: "kind", many: "kinds" } },
    cell: ({ row }) => {
      const action = actionOf(row.original.kind);
      const Action = kindIcon(row.original.kind);
      return (
        <span title={row.original.kind}>
          <TextIcon icon={Action} className={styles.icon} />
          <span className={styles.action}>{action}</span>
        </span>
      );
    },
  }),
  column.display({
    id: "repository",
    header: "repository",
    size: 120,
    meta: { filter: { param: "repository", many: "Repositories" } },
    cell: ({ row }) => repositoryText(row.original),
  }),
  column.display({
    id: "machine",
    header: "machine",
    size: 120,
    meta: { filter: { param: "machine", many: "Machines" } },
    cell: ({ row }) => machineText(row.original),
  }),
  column.display({
    id: "subject",
    header: "subject",
    size: 200,
    meta: { filter: { param: "subject", linked: true } }, // as `clone=…` or `worktree=…`
    cell: ({ row, table }) => {
      const event = row.original;
      // A Repository's own Events: its name is in the column before.
      if (event.subject.type === "repository") return "";
      const home = table.options.meta?.home;
      const Entity = entityIcon(event.subject.type, event.subject.chassis);
      return (
        <span title={subjectTitle(event, home)}>
          <TextIcon icon={Entity} className={styles.icon} />
          {subjectText(event, home)}
        </span>
      );
    },
  }),
  column.display({
    id: "summary",
    header: "summary",
    cell: ({ row }) => row.original.summary,
    size: 480,
    meta: { identifies: true },
  }),
]);

/** Those without the Machine's, for a single Machine: all its Events name the same one. */
export const oneMachineColumns = columns.filter((column) => column.id !== "machine");
