import { FlexRender, type ReactTable, type RowData } from "@tanstack/react-table";
import { ChevronRight, FunnelX } from "lucide-react";
import {
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
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
  oneLine?: boolean; // its rows stay in one line in narrow Panels, as high as when wide
  choices: Record<string, Choice[] | undefined>; // each filtering column's
  message: string | null; // instead of rows, or below them
  stale?: boolean; // dims what is shown, e.g. while other filters' rows load
  paging?: Paging;
  older: string; // what the paging loads: `Events`
  tone?: (row: TData) => Tone | undefined;
  squareTitle?: (row: TData) => string; // what the square says, e.g. its colour
  detailsLabel: string; // `Event details`
  details: (row: TData) => ReactNode; // shown below a row opened
  bareDetails?: boolean; // as wide as the list, without a box: e.g. diffs, which have their own
  folds?: (row: TData) => boolean; // whether a row opens the rows within it instead
  plain?: (row: TData) => boolean; // whether a row opens nothing, as it shows all it has
  opens?: (row: TData) => ((click: MouseEvent) => void) | undefined; // another View, as clicked
  showing?: (row: TData) => boolean; // whether a View it opens is shown, which marks it
  opened?: ReadonlySet<string>; // the rows whose details are open, if not kept here
  onOpenedChange?: (opened: ReadonlySet<string>) => void;
}

/**
 * A list as a table: its columns' headers, which filter and resize; rows that open their
 * details below them, or the rows within them where they fold, or another View, each beside a
 * square, which a first column of `Chevron`s fills (plain rows open nothing); more
 * rows as the end comes into view. A row opens by its first cell's button, or by a click
 * anywhere else on it but on its cells' own buttons and links; one opening a View, also by
 * the middle button. Cells cut off show their whole
 * text when hovered. Narrow Panels show each row in the View's two lines (or one, keeping its
 * height), unless the list is wide: then it scrolls sideways, its details staying in view.
 * A row whose View is shown, in any Group, is marked.
 */
export function ListTable<TData extends RowData>({
  table,
  className,
  wide,
  oneLine,
  choices,
  message,
  stale,
  paging,
  older,
  tone,
  squareTitle,
  detailsLabel,
  details,
  bareDetails,
  folds,
  plain,
  opens,
  showing,
  opened,
  onOpenedChange,
}: Props<TData>) {
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  const open = opened ?? kept;
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
  const toggle = (id: string) => {
    const next = new Set(open);
    if (!next.delete(id)) next.add(id);
    (onOpenedChange ?? setKept)(next);
  };
  // Not a click on a cell's own button or link, nor one ending a text selection; a double
  // click's second is not, so that selecting a word leaves the row as it was.
  const clickRow = (event: MouseEvent, opening: () => void) => {
    if ((event.target as Element).closest("button, a")) return;
    const selected = (document.getSelection()?.toString() ?? "") !== "";
    if (event.detail > 2 || (event.detail === 1 && selected)) return;
    opening();
  };
  const rows = table.getRowModel().rows;
  const filtered = table.state.columnFilters.length > 0;
  const grid = { "--columns": gridColumns(table.getVisibleLeafColumns()) } as CSSProperties;
  return (
    <div
      className={`${styles.frame} ${className ?? ""}`}
      data-stale={stale || undefined}
      data-wide={wide || undefined}
      data-one-line={oneLine || undefined}
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
          <ol className={styles.rows} onPointerOver={showCutOff}>
            {rows.map((row, index) => {
              const view = opens?.(row.original);
              const still = view === undefined && (plain?.(row.original) ?? false);
              const folding = folds?.(row.original) ?? false;
              const shown = folding ? row.getIsExpanded() : open.has(row.id);
              let opening: (click: MouseEvent) => void = folding
                ? () => row.toggleExpanded()
                : () => toggle(row.id);
              if (view !== undefined) opening = view;
              const middle = (click: MouseEvent) => click.button === 1 && view?.(click);
              const id = `${list}-${index}`; // a row's ID may be any text, so not in IDs
              const [first, ...others] = row.getVisibleCells();
              return (
                <li
                  key={row.id}
                  className={styles.item}
                  data-tone={tone?.(row.original)}
                  data-depth={row.depth || undefined}
                >
                  {/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: a shortcut for the mouse; its button opens it by keyboard */}
                  <div
                    id={id}
                    className={styles.row}
                    data-plain={still || undefined}
                    data-showing={showing?.(row.original) || undefined}
                    onClick={still ? undefined : (event) => clickRow(event, () => opening(event))}
                    onAuxClick={view && ((event) => clickRow(event, () => middle(event)))}
                  >
                    {first && still && (
                      <span data-column={first.column.id}>
                        <FlexRender cell={first} />
                      </span>
                    )}
                    {first && !still && (
                      <span data-column={first.column.id}>
                        <button
                          type="button"
                          className={styles.open}
                          aria-expanded={view ? undefined : shown}
                          aria-controls={shown && !folding && !view ? `${id}-details` : undefined}
                          aria-labelledby={id}
                          title={squareTitle?.(row.original)}
                          onClick={opening}
                          onAuxClick={view && middle}
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
                  {shown && !folding && !still && !view && (
                    <section
                      id={`${id}-details`}
                      className={styles.details}
                      aria-label={detailsLabel}
                      data-bare={bareDetails || undefined}
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

/** Gives the hovered cell its whole text as a tooltip while cut off; its parts' own still win. */
function showCutOff(event: PointerEvent) {
  const cell = (event.target as Element).closest(`.${styles.row} > *`);
  if (!(cell instanceof HTMLElement)) return;
  if (cell.scrollWidth > cell.clientWidth) cell.title = cell.textContent ?? "";
  else cell.removeAttribute("title");
}

/** A row's square: the chevron that turns as its details open. */
export function Chevron() {
  return <ChevronRight className={styles.chevron} aria-hidden="true" />;
}
