import type { ListLayout } from "../../components/list/kept";
import { List, type Paging } from "../../components/list/List";
import { useList } from "../../components/list/table";
import type { Checkout } from "../checkout";
import { changesViews } from "../comparison/ChangesLinks";
import { useIsShown } from "../opening";
import { CommitBox } from "./CommitBox";
import styles from "./CommitList.module.css";
import { commitColumns, type FoundActions } from "./columns";
import { GraphBeside } from "./Graph";
import { type Entry, entryId, graphOf } from "./rows";

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
  graph: boolean; // whether to draw the graph: only for commits listed in an order with every
  // child above its parents, and none left out between
}

/**
 * Commits, newest first, as History lists them: a row opens all about its commit; its hash, its
 * changes. A row is marked while its commit's Changes or Diff is shown. With `graph`, a column
 * draws their lanes, which go on beside a commit's details opened below its row.
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
  graph,
}: Props) {
  const isShown = useIsShown();
  const drawn = graph ? graphOf(entries, head) : undefined;
  const table = useList(kind, layout, {
    columns: commitColumns(checkout, head, actions, drawn),
    data: entries,
    getRowId: entryId,
    meta: { now },
  });
  const column = drawn && table.getColumn("graph");
  const lanes = column?.getIsVisible() ? drawn : undefined;
  return (
    <List
      table={table}
      label="Commits"
      className={`${styles.list} ${lanes ? styles.graphed : ""}`}
      vars={column ? { "--graph-width": `${column.getSize()}px` } : undefined}
      layout={layout}
      choices={{}}
      message={message}
      stale={stale}
      paging={paging}
      older="commits"
      detailsLabel="Commit details"
      details={(entry) => {
        if (entry.type !== "commit" || checkout === undefined) return null;
        const row = lanes?.rows.get(entryId(entry));
        return (
          <>
            {lanes && row !== undefined && <GraphBeside layout={lanes.layout} row={row} />}
            <CommitBox commit={entry.commit} checkout={checkout} now={now} />
          </>
        );
      }}
      plain={(entry) => entry.type !== "commit"}
      showing={(entry) =>
        entry.type === "commit" &&
        checkout !== undefined &&
        changesViews(checkout, entry.commit.hash).some((address) => isShown(address))
      }
    />
  );
}
