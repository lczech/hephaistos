import { FlexRender, type ReactTable, type RowData } from "@tanstack/react-table";
import { ChevronRight, FunnelX } from "lucide-react";
import {
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { cssVars } from "../cssVars";
import { ColumnHeader } from "./ColumnHeader";
import { ColumnsMenu } from "./ColumnsMenu";
import { arrangeable, type ColumnLook, gridColumns } from "./columns";
import type { Choice } from "./filters";
import type { ListLayout } from "./kept";
import type { ListFeatures } from "./list";
import styles from "./table.module.css";

/** How a row's square is coloured: amber, red, or filled red; or its row quieter. */
export type Tone = "warning" | "danger" | "alarm" | "muted";

/** A click with the right button, or the menu key's. */
type Clicked = Pick<globalThis.MouseEvent, "target" | "clientX" | "clientY" | "preventDefault">;

const NO_VALUES: string[] = [];

/** Where a list's header menu opens, for which column, and whether by the keyboard. */
interface Menu {
  x: number;
  y: number;
  column: string | undefined;
  keyboard: boolean;
}

/** Of an endless list: whether there is more, and how to get it (as TanStack Query's). */
interface Paging {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
}

interface Props<TData extends RowData> {
  table: ReactTable<ListFeatures, TData>;
  className?: string; // the View's, e.g. for its look in two lines per row
  layout: ListLayout;
  embedded?: boolean; // part of a page that scrolls: then it only scrolls sideways itself
  oneLine?: boolean; // its rows stay in one line in the two lines' layout, as high as in columns
  grouped?: boolean; // its rows without depth start groups, a line above each but the first
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
 * the middle button. Cells show their whole text when hovered. In columns, each as wide as set,
 * those beyond the list's width scroll sideways, its details staying in view; in lines, each row
 * shows in the View's two lines (or one, keeping its height). It scrolls itself, its header
 * staying in view, filling what its View leaves below its bar, unless it is part of a page.
 * A row whose View is shown, in any Group, is marked. In columns, its header's menu (the
 * right button, or a long press) hides, shows and moves them, or resets their look; a double
 * click on a column's edge fits it to its cells, at most as wide as the list.
 */
export function ListTable<TData extends RowData>({
  table,
  className,
  layout,
  embedded,
  oneLine,
  grouped,
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
  const frame = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLParagraphElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
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
  // Where the header was clicked, or, from the keyboard, below the header focused. While the
  // menu is open, React Aria makes the page inert, so that a click reaches what it lays over
  // the page, or the document: it is for what lies below by where it is, the header opening the
  // menu there; anything else closes it.
  const showMenu = (event: Clicked) => {
    if (head.current === null) return;
    const below = head.current.contains(event.target as Node)
      ? (event.target as Element)
      : [...head.current.querySelectorAll("[data-column]"), head.current].find((at) =>
          within(at.getBoundingClientRect(), event.clientX, event.clientY),
        );
    if (below === undefined) return setMenu(null);
    event.preventDefault();
    const target = below.closest<HTMLElement>("[data-column]");
    const id = target?.dataset.column;
    const column = id === undefined ? undefined : table.getColumn(id);
    const keyboard = event.clientX === 0 && event.clientY === 0;
    const at =
      keyboard && target
        ? { x: target.getBoundingClientRect().left, y: target.getBoundingClientRect().bottom }
        : { x: event.clientX, y: event.clientY };
    const { left, top } = head.current.getBoundingClientRect();
    setMenu({
      x: at.x - left,
      y: at.y - top,
      column: column && arrangeable(column.columnDef) ? column.id : undefined,
      keyboard,
    });
  };
  useEffect(() => {
    if (menu === null) return;
    const again = (event: globalThis.MouseEvent) => event.defaultPrevented || showMenu(event);
    document.addEventListener("contextmenu", again);
    return () => document.removeEventListener("contextmenu", again);
  });
  // As wide as its widest cell, the header's too: measured with only its width given by them.
  const fitColumn = (id: string, header: HTMLElement) => {
    if (grid.current === null || frame.current === null) return;
    const { style } = grid.current;
    const columns = table.getVisibleLeafColumns();
    style.setProperty("--columns", gridColumns(columns, id));
    const width = header.getBoundingClientRect().width;
    style.setProperty("--columns", gridColumns(columns));
    const room = frame.current.clientWidth; // still all in view, scrolled to
    table.setColumnSizing((sizes) => ({ ...sizes, [id]: Math.ceil(Math.min(width, room)) }));
  };
  const rows = table.getRowModel().rows;
  const filtered = table.state.columnFilters.length > 0;
  const columns = { "--columns": gridColumns(table.getVisibleLeafColumns()) };
  return (
    <div
      ref={frame}
      className={`${styles.frame} ${className ?? ""}`}
      data-stale={stale || undefined}
      data-layout={layout}
      data-embedded={embedded || undefined}
      data-one-line={oneLine || undefined}
      data-grouped={grouped || undefined}
    >
      <div ref={grid} className={styles.grid} style={cssVars(columns)}>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: a context menu, which the menu key opens from a header's buttons too */}
        <div
          ref={head}
          className={styles.head}
          onContextMenu={layout === "columns" ? showMenu : undefined}
        >
          {table
            .getHeaderGroups()
            .flatMap((group) => group.headers)
            .map((header) => {
              const label = header.column.columnDef.header;
              return (
                <ColumnHeader
                  key={header.id}
                  header={header}
                  sorted={header.column.getIsSorted()}
                  values={(header.column.getFilterValue() as string[] | undefined) ?? NO_VALUES}
                  resizing={header.column.getIsResizing()}
                  choices={choices[header.column.id]}
                  onFit={(element) => fitColumn(header.column.id, element)}
                >
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
          {menu && (
            <>
              <span
                ref={anchor}
                className={styles.anchor}
                style={cssVars({ "--x": `${menu.x}px`, "--y": `${menu.y}px` })}
              />
              <ColumnsMenu
                key={`${menu.x} ${menu.y}`} // opened anew where clicked again
                table={table}
                clicked={menu.column}
                anchor={anchor}
                keyboard={menu.keyboard}
                onClose={() => setMenu(null)}
              />
            </>
          )}
        </div>
        {rows.length > 0 && (
          <ol className={styles.rows} onPointerOver={showWholeText}>
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
                      <span {...cellData(first.column)}>
                        <FlexRender cell={first} />
                      </span>
                    )}
                    {first && !still && (
                      <span {...cellData(first.column)}>
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
                      <span key={cell.id} {...cellData(cell.column)}>
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

/** What a cell says of its column, for its look. */
function cellData(column: { id: string; columnDef: { meta?: ColumnLook } }) {
  const meta = column.columnDef.meta;
  return {
    "data-column": column.id,
    "data-second": meta?.second || undefined,
    "data-figures": meta?.figures || undefined,
  };
}

function within(box: DOMRect, x: number, y: number): boolean {
  return x >= box.left && x < box.right && y >= box.top && y < box.bottom;
}

/**
 * Gives the hovered cell its whole text as a tooltip, as what a cell shows may be cut off, and
 * is known only once drawn; its parts' own tooltips still win.
 */
function showWholeText(event: PointerEvent) {
  const cell = (event.target as Element).closest(`.${styles.row} > *`);
  if (!(cell instanceof HTMLElement)) return;
  const text = cell.textContent?.trim() ?? "";
  if (text === "") cell.removeAttribute("title");
  else cell.title = text;
}

/** A row's square: the chevron that turns as its details open. */
export function Chevron() {
  return <ChevronRight className={styles.chevron} aria-hidden="true" />;
}
