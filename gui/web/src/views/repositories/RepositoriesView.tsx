import { functionalUpdate } from "@tanstack/react-table";
import { useInfo, useRepositories } from "../../api/queries";
import { columnWidths, useListLayout } from "../../components/table/kept";
import { LayoutChoice } from "../../components/table/LayoutChoice";
import { ListTable } from "../../components/table/ListTable";
import { useListTable } from "../../components/table/list";
import { BarEnd, ViewBar, ViewPage } from "../../components/ViewBar";
import { useNow } from "../../useNow";
import type { ViewProps } from "../index";
import { columns } from "./columns";
import styles from "./RepositoriesView.module.css";
import { RepositoryDetails } from "./RepositoryDetails";
import { entries, entryId, sortFragment, sorting, tone } from "./rows";

/**
 * The Repositories, each with its Clones and their Worktrees within it, as `repo show` lists
 * them; the most recently active first, or as its fragment's `sort` says.
 */
export function RepositoriesView({ fragment, setFragment }: ViewProps) {
  const repositories = useRepositories();
  const home = useInfo().data?.home;
  const now = useNow(10_000);
  const listed = entries(repositories.data ?? []);
  const sorted = sorting(fragment);
  const [layout, setLayout] = useListLayout("repositories");
  const table = useListTable({
    columns,
    data: listed,
    getRowId: entryId,
    getSubRows: (entry) => entry.subRows,
    atoms: { columnSizing: columnWidths("repositories") },
    state: { sorting: sorted, expanded: true },
    onSortingChange: (change) =>
      setFragment(sortFragment(fragment, functionalUpdate(change, sorted))),
    enableSortingRemoval: false,
    meta: { now, home },
  });
  let message: string | null = null;
  if (repositories.data === undefined) {
    message = repositories.isError
      ? `Couldn't load: ${repositories.error.message}`
      : "Loading Repositories…";
  } else if (listed.length === 0) {
    message =
      "No Repositories yet: register them with `hephaistos scan` or `hephaistos clone register`.";
  }
  return (
    <ViewPage>
      <ViewBar>
        <BarEnd>
          <LayoutChoice layout={layout} onChange={setLayout} />
        </BarEnd>
      </ViewBar>
      <ListTable
        table={table}
        className={styles.repositories}
        layout={layout}
        choices={{}}
        message={message}
        stale={repositories.isError}
        older="Repositories"
        tone={tone}
        detailsLabel="Details"
        details={(entry) => <RepositoryDetails entry={entry} now={now} home={home} />}
      />
    </ViewPage>
  );
}
