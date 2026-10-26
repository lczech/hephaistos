import { ForgeLink } from "../../components/ForgeLink";
import { Chevron } from "../../components/table/ListTable";
import { listColumnHelper } from "../../components/table/list";
import { forgePage } from "../../forges";
import { ago, fullTime } from "../../time";
import type { Address } from "../address";
import { ChangesLinks } from "../changes/ChangesLinks";
import type { Checkout } from "../changes/checkout";
import { ViewLink } from "../ViewLink";
import styles from "./RepositoriesView.module.css";
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
 * A row's Views: Events for all; History for a Checkout; Changes and Diff for one with a working
 * tree.
 */
function Views({ entry, home }: { entry: Entry; home: string | undefined }) {
  const name = nameText(entry, home);
  const state = checkout(entry);
  const params: Checkout | undefined =
    state && (entry.type === "worktree" ? { worktree: state.id } : { clone: state.id });
  // Untracked files alone are often left there for good, so they don't call for a look.
  const quiet = state && !(state.staged || state.changed || state.conflicted);
  const untracked = state?.untracked ? `; ${state.untracked} untracked` : "";
  return (
    <span className={styles.views}>
      <ViewLink address={eventsAt(entry)} label={`Events of ${name}`} />
      {params ? (
        <ViewLink address={{ kind: "history", params }} label={`Commit history of ${name}`} />
      ) : (
        <span />
      )}
      {params && state?.staged !== null ? ( // not for a bare Clone
        <ChangesLinks
          checkout={params}
          what={`changes in ${name}`}
          quiet={quiet}
          note={quiet ? `no changes${untracked}` : undefined}
        />
      ) : (
        <>
          <span />
          <span />
        </>
      )}
    </span>
  );
}

/**
 * The Repositories list's columns: Repository rows only name themselves and say when they were
 * last active; their Clones and Worktrees, within them, say the rest.
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
    meta: { width: "calc(var(--icon-size) + 2 * var(--space-half))" }, // the logo, with its padding
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
    meta: { identifies: true },
    cell: ({ row, table }) => {
      const name = nameText(row.original, table.options.meta?.home);
      return <span title={nameTitle(row.original)}>{name}</span>;
    },
  }),
  column.display({
    id: "views", // its Events, History, Changes and Diff, each in its place, so that they line up
    enableResizing: false,
    meta: { width: "var(--views)" },
    cell: ({ row, table }) => <Views entry={row.original} home={table.options.meta?.home} />,
  }),
  column.display({
    id: "branch",
    header: "branch",
    size: 120,
    meta: { second: true },
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
    meta: {
      second: true,
      figures: true,
      description: "When HEAD last moved here; for a repository, in any of its checkouts",
    },
    cell: ({ row, table }) => <Ago at={activeAt(row.original)} now={table.options.meta?.now} />,
  }),
  column.display({
    id: "observed",
    header: "observed",
    size: 88,
    meta: { figures: true, description: "When the checkout was last observed" },
    cell: ({ row, table }) => {
      const state = checkout(row.original);
      return state && <Ago at={state.observed_at} now={table.options.meta?.now} />;
    },
  }),
]);
