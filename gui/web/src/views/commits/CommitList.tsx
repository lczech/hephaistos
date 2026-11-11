import type { ListLayout } from "../../components/list/kept";
import { List, type Paging } from "../../components/list/List";
import { useList } from "../../components/list/table";
import type { Checkout } from "../checkout";
import { changesViews } from "../comparison/ChangesLinks";
import { useIsShown } from "../opening";
import { CommitBox } from "./CommitBox";
import styles from "./CommitList.module.css";
import { commitColumns, type FoundActions } from "./columns";
import { type Entry, entryId } from "./rows";

interface Props {
  kind: string; // whose list it is, for its kept widths, order and hidden columns: `history`
  checkout: Checkout | undefined;
  entries: Entry[];
  head: string | null | undefined; // the commit HEAD is at, whose row says so
  actions: FoundActions;
  layout: ListLayout;
  now: number;
  message: string | null;
  stale: boolean;
  paging: Paging;
}

/**
 * Commits, newest first, as History lists them: a row opens all about its commit; its hash, its
 * changes. A row is marked while its commit's Changes or Diff is shown.
 */
export function CommitList({
  kind,
  checkout,
  entries,
  head,
  actions,
  layout,
  now,
  message,
  stale,
  paging,
}: Props) {
  const isShown = useIsShown();
  const table = useList(kind, layout, {
    columns: commitColumns(checkout, head, actions),
    data: entries,
    getRowId: entryId,
    meta: { now },
  });
  return (
    <List
      table={table}
      label="Commits"
      className={styles.list}
      layout={layout}
      choices={{}}
      message={message}
      stale={stale}
      paging={paging}
      older="commits"
      detailsLabel="Commit details"
      details={(entry) =>
        entry.type === "commit" &&
        checkout && <CommitBox commit={entry.commit} checkout={checkout} now={now} />
      }
      plain={(entry) => entry.type !== "commit"}
      showing={(entry) =>
        entry.type === "commit" &&
        checkout !== undefined &&
        changesViews(checkout, entry.commit.hash).some((address) => isShown(address))
      }
    />
  );
}
