import { functionalUpdate } from "@tanstack/react-table";
import { useMemo } from "react";
import { POLL_INTERVAL, useInfo, useRepositories } from "../../api/queries";
import { ListTable } from "../../components/table/ListTable";
import { useListTable } from "../../components/table/list";
import { columnWidths } from "../../components/table/widths";
import { useNow } from "../../useNow";
import type { ViewProps } from "../index";
import { columns } from "./columns";
import styles from "./RepositoriesView.module.css";
import { RepositoryDetails } from "./RepositoryDetails";
import { entries, entryId, sorting, sortParams, tone } from "./rows";

/**
 * The Repositories, each with its Clones and their Worktrees within it, as `repo show` lists
 * them; the most recently active first, or as its parameter `sort` says.
 */
export function RepositoriesView({ params, setParams }: ViewProps) {
  const repositories = useRepositories(POLL_INTERVAL);
  const home = useInfo().data?.home;
  const now = useNow(10_000);
  const listed = useMemo(() => entries(repositories.data ?? []), [repositories.data]);
  const sorted = useMemo(() => sorting(params), [params]);
  const table = useListTable({
    columns,
    data: listed,
    getRowId: entryId,
    getSubRows: (entry) => entry.subRows,
    atoms: { columnSizing: columnWidths("repositories") },
    state: { sorting: sorted, expanded: true },
    onSortingChange: (change) => setParams(sortParams(params, functionalUpdate(change, sorted))),
    enableSortingRemoval: false,
    meta: { now, home },
  });
  let message: string | null = null;
  if (repositories.data === undefined) {
    message = repositories.isError
      ? `No answer: ${repositories.error.message}`
      : "Asking for Repositories…";
  } else if (listed.length === 0) {
    message = "No Repositories yet: add them with `hephaistos scan` or `hephaistos clone add`.";
  }
  return (
    <ListTable
      table={table}
      className={styles.repositories}
      choices={{}}
      message={message}
      stale={repositories.isError}
      older="Repositories"
      tone={tone}
      detailsLabel="Details"
      details={(entry) => <RepositoryDetails entry={entry} now={now} home={home} />}
    />
  );
}
