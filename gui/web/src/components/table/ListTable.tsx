import { FlexRender, type ReactTable, type RowData } from "@tanstack/react-table";
import { ChevronRight, FunnelX } from "lucide-react";
import { type CSSProperties, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { ColumnHeader } from "./ColumnHeader";
import { gridColumns } from "./columns";
import type { Choice } from "./filters";
import type { ListFeatures } from "./list";
import styles from "./table.module.css";

/** How a row's square is coloured: amber, red, or filled red; or its row quieter. */
export type Tone = "warning" | "danger" | "alarm" | "muted";

/** Of an endless list: whether there is more, and how to get it (as TanStack Query's). */
interface Paging {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
}

interface Props<TData extends RowData> {
  table: ReactTable<ListFeatures, TData>;
  className?: string; // the View's, e.g. for its two lines per row in narrow Panels
  wide?: boolean; // scrolls sideways instead, for more columns than fit
  choices: Record<string, Choice[] | undefined>; // each filtering column's
  message: string | null; // instead of rows, or below them
  stale?: boolean; // dims what is shown, e.g. while other filters' rows load
  paging?: Paging;
  older: string; // what the paging loads: `Events`
  tone?: (row: TData) => Tone | undefined;
  rowTitle?: (row: TData) => string;
  detailsLabel: string; // `Event details`
  details: (row: TData) => ReactNode; // shown below a row opened
}

/**
 * A list as a table: its columns' headers, which filter and resize; rows that open their
 * details below them, each beside a square, which a first column of `Chevron`s fills; more
 * rows as the end comes into view. A row opens by its first cell's button, which covers the
 * row, so that other cells may hold buttons of their own. Narrow Panels show each row in the View's two lines, unless
 * the list is wide: then it scrolls sideways, its details staying in view.
 */
export function ListTable<TData extends RowData>({
  table,
  className,
  wide,
  choices,
  message,
  stale,
  paging,
  older,
  tone,
  rowTitle,
  detailsLabel,
  details,
}: Props<TData>) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const end = useRef<HTMLParagraphElement>(null);
  const list = useId();
  const { hasNextPage = false, isFetchingNextPage = false, fetchNextPage } = paging ?? {};
  // Scrolling to the end of the list loads the page before it.
  useEffect(() => {
    if (end.current === null || !hasNextPage || isFetchingNextPage) return;
    const observer = new IntersectionObserver(([seen]) => {
      if (seen?.isIntersecting) void fetchNextPage?.();
    });
    observer.observe(end.current);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  const toggle = (id: string) =>
    setOpen((was) => {
      const next = new Set(was);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const rows = table.getRowModel().rows;
  const filtered = table.state.columnFilters.length > 0;
  // Set by script, which the Content-Security-Policy allows, unlike style attributes in markup.
  const grid = { "--columns": gridColumns(table.getVisibleLeafColumns()) } as CSSProperties;
  return (
    <div
      className={`${styles.frame} ${className ?? ""}`}
      data-stale={stale || undefined}
      data-wide={wide || undefined}
    >
      <div className={styles.grid} style={grid}>
        <div className={styles.head}>
          {table
            .getHeaderGroups()
            .flatMap((group) => group.headers)
            .map((header) => {
              const label = header.column.columnDef.header;
              return (
                <ColumnHeader key={header.id} header={header} choices={choices[header.column.id]}>
                  {typeof label === "string" ? label : undefined}
                </ColumnHeader>
              );
            })}
          {filtered && (
            <button
              type="button"
              className={styles.clear}
              onClick={() => table.resetColumnFilters(true)}
              title="Clear all filters"
              aria-label="Clear all filters"
            >
              <FunnelX aria-hidden="true" />
            </button>
          )}
        </div>
        {rows.length > 0 && (
          <ol className={styles.rows}>
            {rows.map((row, index) => {
              const shown = open.has(row.id);
              const id = `${list}-${index}`; // a row's ID may be any text, so not in IDs
              const [first, ...others] = row.getVisibleCells();
              return (
                <li
                  key={row.id}
                  className={styles.item}
                  data-tone={tone?.(row.original)}
                  data-depth={row.depth || undefined}
                >
                  <div id={id} className={styles.row} title={rowTitle?.(row.original)}>
                    {first && (
                      <span data-column={first.column.id}>
                        <button
                          type="button"
                          className={styles.open}
                          aria-expanded={shown}
                          aria-controls={shown ? `${id}-details` : undefined}
                          aria-labelledby={id}
                          onClick={() => toggle(row.id)}
                        >
                          <FlexRender cell={first} />
                        </button>
                      </span>
                    )}
                    {others.map((cell) => (
                      <span key={cell.id} data-column={cell.column.id}>
                        <FlexRender cell={cell} />
                      </span>
                    ))}
                  </div>
                  {shown && (
                    <section
                      id={`${id}-details`}
                      className={styles.details}
                      aria-label={detailsLabel}
                    >
                      {details(row.original)}
                    </section>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
      {message !== null && <p className={styles.quiet}>{message}</p>}
      {hasNextPage && (
        <p ref={end} className={styles.quiet}>
          {isFetchingNextPage ? `Loading older ${older}…` : `Older ${older} load as you scroll.`}
        </p>
      )}
    </div>
  );
}

/** A row's square: the chevron that turns as its details open. */
export function Chevron() {
  return <ChevronRight className={styles.chevron} aria-hidden="true" />;
}
