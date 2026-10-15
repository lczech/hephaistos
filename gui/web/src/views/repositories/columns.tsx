import { Chevron } from "../../components/table/ListTable";
import { listColumnHelper } from "../../components/table/list";
import { ago, fullTime } from "../../time";
import type { Address } from "../address";
import { ViewLink } from "../ViewLink";
import {
  activeAt,
  branchText,
  checkout,
  type Entry,
  nameKey,
  nameText,
  statusText,
  statusTitle,
} from "./rows";

const column = listColumnHelper<Entry>();

/** A time as `5m ago`, in full when hovered; nothing if unknown. */
function Ago({ at, now }: { at: string | null; now: number | undefined }) {
  if (at === null) return "";
  return <span title={fullTime(at)}>{ago(at, now ?? Date.now())}</span>;
}

/** When the row was last active, to sort by; unknown ones go last either way. */
function activeTime(entry: Entry): number | undefined {
  const at = activeAt(entry);
  return at === null ? undefined : Date.parse(at);
}

/** Where the row's Events are: the Repository's, or the Checkout's own. */
function eventsAt(entry: Entry): Address {
  if (entry.type === "clone") return { kind: "events", params: { clone: entry.clone.id } };
  if (entry.type === "worktree") return { kind: "events", params: { worktree: entry.worktree.id } };
  return { kind: "events", params: { repository: entry.repository.id } };
}

/**
 * The Repositories list's columns: Repository rows only name themselves and say when they were
 * last active; their Clones and Worktrees, within them, say the rest. The last column takes the
 * width the others leave.
 */
export const columns = column.columns([
  column.display({
    id: "square",
    cell: Chevron,
    enableResizing: false,
    meta: { width: "var(--square)" },
  }),
  column.accessor(nameKey, {
    id: "name",
    header: "name",
    enableSorting: true,
    sortFn: "text",
    size: 280,
    cell: ({ row, table }) => {
      const name = nameText(row.original, table.options.meta?.home);
      return <span title={name}>{name}</span>;
    },
  }),
  column.display({
    id: "events",
    enableResizing: false,
    meta: { width: "var(--square)" },
    cell: ({ row, table }) => (
      <ViewLink
        address={eventsAt(row.original)}
        label={`Events of ${nameText(row.original, table.options.meta?.home)}`}
      />
    ),
  }),
  column.display({
    id: "branch",
    header: "branch",
    size: 120,
    cell: ({ row }) => {
      const state = checkout(row.original);
      return state === undefined ? "" : branchText(state);
    },
  }),
  column.display({
    id: "status",
    header: "status",
    size: 110,
    cell: ({ row }) => {
      const state = checkout(row.original);
      if (state === undefined) return "";
      return <span title={statusTitle(state)}>{statusText(state)}</span>;
    },
  }),
  column.accessor(activeTime, {
    id: "active",
    header: "active",
    size: 88,
    enableSorting: true,
    sortFn: "basic",
    sortDescFirst: true,
    sortUndefined: "last",
    cell: ({ row, table }) => <Ago at={activeAt(row.original)} now={table.options.meta?.now} />,
  }),
  column.display({
    id: "observed",
    header: "observed",
    enableResizing: false,
    meta: { width: "minmax(88px, 1fr)" },
    cell: ({ row, table }) => {
      const state = checkout(row.original);
      return state && <Ago at={state.observed_at} now={table.options.meta?.now} />;
    },
  }),
]);
