import { ForgeLink } from "../../components/ForgeLink";
import { Chevron } from "../../components/table/ListTable";
import { listColumnHelper } from "../../components/table/list";
import { forgePage } from "../../forges";
import { ago, fullTime } from "../../time";
import type { Address, Params } from "../address";
import { ViewLink } from "../ViewLink";
import {
  activeAt,
  branchText,
  branchTitle,
  checkout,
  type Entry,
  nameKey,
  nameText,
  nameTitle,
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
  column.display({
    id: "remote", // a Repository's page on its forge, if a main remote is on one
    enableResizing: false,
    meta: { width: "calc(1em + 4px)" }, // the logo, with its padding
    cell: ({ row }) => {
      if (row.original.type !== "repository") return "";
      const [page] = row.original.repository.remotes.flatMap((remote) => forgePage(remote) ?? []);
      return page && <ForgeLink page={page} />;
    },
  }),
  column.accessor(nameKey, {
    id: "name",
    header: "name",
    enableSorting: true,
    sortFn: "text",
    size: 280,
    cell: ({ row, table }) => {
      const name = nameText(row.original, table.options.meta?.home);
      return <span title={nameTitle(row.original)}>{name}</span>;
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
        opening={{ beside: true, preview: true }}
      />
    ),
  }),
  column.display({
    id: "changes",
    enableResizing: false,
    meta: { width: "var(--square)" },
    cell: ({ row, table }) => {
      const entry = row.original;
      const state = checkout(entry);
      if (state === undefined || state.staged === null) return ""; // a Repository, or bare
      const params: Params =
        entry.type === "worktree" ? { worktree: state.id } : { clone: state.id };
      // Untracked files alone are often left there for good, so they don't call for a look.
      const quiet = !(state.staged || state.changed || state.conflicted);
      const untracked = state.untracked ? `; ${state.untracked} untracked` : "";
      return (
        <ViewLink
          address={{ kind: "changes", params }}
          label={`Changes in ${nameText(entry, table.options.meta?.home)}`}
          opening={{ beside: true, preview: true }}
          quiet={quiet}
          note={quiet ? `no changes${untracked}` : undefined}
        />
      );
    },
  }),
  column.display({
    id: "branch",
    header: "branch",
    size: 120,
    cell: ({ row }) => {
      const state = checkout(row.original);
      return state && <span title={branchTitle(state)}>{branchText(state)}</span>;
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
    meta: { description: "When HEAD last moved here; for a Repository, in any of its Checkouts" },
    cell: ({ row, table }) => <Ago at={activeAt(row.original)} now={table.options.meta?.now} />,
  }),
  column.display({
    id: "observed",
    header: "observed",
    enableResizing: false,
    meta: { width: "minmax(88px, 1fr)", description: "When the Checkout was last observed" },
    cell: ({ row, table }) => {
      const state = checkout(row.original);
      return state && <Ago at={state.observed_at} now={table.options.meta?.now} />;
    },
  }),
]);
