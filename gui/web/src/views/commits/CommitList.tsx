import type { RefObject } from "react";
import type { ListLayout } from "../../components/list/kept";
import { List, type ListHandle, type Paging } from "../../components/list/List";
import { useList } from "../../components/list/table";
import type { Checkout } from "../checkout";
import { changesViews } from "../comparison/ChangesLinks";
import { useIsShown } from "../opening";
import { CommitBox } from "./CommitBox";
import styles from "./CommitList.module.css";
import { commitColumns, type FoundActions } from "./columns";
import { GraphBeside } from "./Graph";
import { type Drawing, type Entry, entryId, graphOf } from "./rows";
import { tipsBand } from "./Tips";

interface Props {
  kind: string; // whose list it is, for its kept widths, order and hidden columns: `history`
  checkout: Checkout | undefined;
  entries: Entry[];
  head: string | null | undefined; // the commit HEAD is at, whose row says so
  actions?: FoundActions; // for a commit searched for by its hash, not listed
  layout: ListLayout;
  now: number;
  message: string | null;
  stale: boolean;
  paging: Paging;
  graph: Drawing | undefined; // how to draw the graph, if at all: only for commits listed in an
  // order with every child above its parents, and none left out between
  handle?: RefObject<ListHandle | null>; // to go to a row, by its ID (`entryId`)
  onTip?: (id: string) => void; // with the graph: its tips above stay below the header (`tipsBand`)
}

/**
 * Commits, newest first, as History lists them: a row opens all about its commit; its hash, its
 * changes. A row is marked while its commit's Changes or Diff is shown. With `graph`, a column
 * draws their lanes, which go on beside a commit's details opened below its row; with `onTip`,
 * the tips of those passing the row at the top stay below the header, a click going to one.
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
  handle,
  onTip,
}: Props) {
  const isShown = useIsShown();
  const drawn = graph && graphOf(entries, head, graph);
  const table = useList(kind, layout, {
    columns: commitColumns(checkout, head, actions, drawn),
    data: entries,
    getRowId: entryId,
    meta: { now },
  });
  const column = drawn && table.getColumn("graph");
  const lanes = column?.getIsVisible() ? drawn : undefined;
  const tips = lanes && onTip && tipsBand(lanes, head, onTip);
  return (
    <List
      table={table}
      label="Commits"
      handle={handle}
      band={
        tips &&
        ((entry, next) => {
          const row = lanes?.rows.get(entryId(entry));
          const below = next && lanes?.rows.get(entryId(next.row));
          const coming = below === undefined || !next ? undefined : { ...next, row: below };
          return row === undefined ? null : tips(row, coming);
        })
      }
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
