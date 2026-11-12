import { FlexRender, type ReactTable, type RowData } from "@tanstack/react-table";
import { ChevronRight, FunnelX } from "lucide-react";
import {
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { type CssVars, cssVars } from "../cssVars";
import { ColumnHeader } from "./ColumnHeader";
import { ColumnsMenu } from "./ColumnsMenu";
import { useColumnDrop } from "./columnDrop";
import { arrangeable, type ColumnLook, gridColumns } from "./columns";
import type { Choice } from "./filters";
import type { ListLayout } from "./kept";
import { LinesHead } from "./LinesHead";
import styles from "./list.module.css";
import { type RowAction, RowMenu } from "./RowMenu";
import type { ListFeatures } from "./table";
import { type Drawn, VirtualRows } from "./VirtualRows";

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
  vars?: CssVars; // the View's, for its stylesheet: e.g. a column's width, from what it shows
  layout: ListLayout;
  embedded?: boolean; // part of a page that scrolls: then it only scrolls sideways itself
  oneLine?: boolean; // its rows stay in one line in the two lines' layout, as high as in columns
  grouped?: boolean; // its rows without depth start groups, a line above each but the first
  tree?: boolean; // its square holds only a tree's chevrons, so it is as narrow as they are
  compact?: boolean; // its rows closer together, e.g. a tree of files, a sidebar's list
  choices: Record<string, Choice[] | undefined>; // each filtering column's
  message: string | null; // instead of rows, or below them
  problem?: boolean; // the message says something is wrong, e.g. that loading failed
  stale?: boolean; // dims what is shown, e.g. while other filters' rows load
  paging?: Paging;
  older: string; // what the paging loads: `events`
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
  actions?: (row: TData) => ReactNode; // after what names it (`identifies`), while pointed at
  menu?: (row: TData) => { label: string; groups: RowAction[][] } | undefined; // its menu, if any
  ahead?: (row: TData) => void; // pointed at or focused: to ask for what opening it shows
  seen?: (row: TData) => void; // come into view, or near it: to ask for what it shows
}

/**
 * A list as a table: its columns' headers, which filter and resize; rows that open their
 * details below them, or the rows within them where they fold, or another View, each beside a
 * square, which a first column of `Chevron`s fills (plain rows open nothing); more
 * rows as the end comes into view. A row opens by its first cell's button, or by a click
 * anywhere else on it but on its cells' own buttons and links; one opening a View, also by
 * the middle button. Cells show their whole text when hovered. In columns, each as wide as set,
 * those beyond the list's width scroll sideways, its details staying in view; in lines, each row
 * shows in the View's two lines (or one, keeping its height), below buttons for its filters and
 * its sort instead of headers. It scrolls itself, its header staying in view, filling what its
 * View leaves below its bar, unless it is part of a page. A row whose View is shown, in any
 * Group, is marked. In columns, its header's menu (the right button, or a long press) hides,
 * shows and moves them, or resets their look; a double click on a column's edge fits it to its
 * cells, at most as wide as the list.
 *
 * As a `tree`, a row's rows are drawn within it, its square as narrow as its chevrons, and a row
 * holding rows stays in view below the header and those holding it while they scroll past,
 * unless it is part of a page. A row may have actions after what names it, shown while it is
 * pointed at or focused, and a menu (the right button, or the menu key: its first item focused
 * then); `ahead` is called as a row is pointed at or focused, to ask for what opening it shows,
 * `seen` as it comes into view or near it, to ask for what it shows.
 * `compact` rows stand closer together.
 */
export function List<TData extends RowData>({
  table,
  className,
  vars,
  layout,
  embedded,
  oneLine,
  grouped,
  tree,
  compact,
  choices,
  message,
  problem,
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
  actions,
  menu: rowMenu,
  ahead,
  seen,
}: Props<TData>) {
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  const open = opened ?? kept;
  const frame = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLParagraphElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  // A row's menu: which row's, where in it, and whether asked for by the keyboard.
  const [rowMenuAt, setRowMenuAt] = useState<{
    id: string;
    x: number;
    y: number;
    keyboard: boolean;
  } | null>(null);
  const rowAnchor = useRef<HTMLSpanElement>(null);
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
  // The header's height, as drawn, for the rows stuck below it: in lines its buttons have their
  // own height, and wrap where narrow. Not rounded, as rows are a fraction of a pixel high.
  useEffect(() => {
    const [at, box] = [head.current, frame.current];
    if (at === null || box === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() =>
      box.style.setProperty("--head-height", `${at.getBoundingClientRect().height}px`),
    );
    observer.observe(at);
    return () => observer.disconnect();
  }, []);
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
  // A row's menu where it was clicked or long pressed; from the keyboard, below its start. Made
  // only then: a row without one leaves the browser's own.
  const showRowMenu = (event: MouseEvent<HTMLDivElement>, row: TData, id: string) => {
    if (rowMenu?.(row) === undefined) return;
    event.preventDefault();
    const box = event.currentTarget.getBoundingClientRect();
    const keyboard = event.clientX === 0 && event.clientY === 0;
    const [x, y] = keyboard ? [0, box.height] : [event.clientX - box.left, event.clientY - box.top];
    setRowMenuAt({ id, x, y, keyboard });
  };
  const { dropProps, line, carried } = useColumnDrop(table, head, layout);
  useEffect(() => {
    if (menu === null) return;
    const again = (event: globalThis.MouseEvent) => event.defaultPrevented || showMenu(event);
    document.addEventListener("contextmenu", again);
    return () => document.removeEventListener("contextmenu", again);
  });
  // As wide as its widest cell, the header's too: measured with only its width given by them,
  // in each row, as each lays out the columns on its own; those of lists within details aside.
  const fitColumn = (id: string) => {
    const [at, box] = [grid.current, frame.current];
    if (at === null || box === null) return;
    const columns = table.getVisibleLeafColumns();
    at.style.setProperty("--columns", gridColumns(columns, id));
    const cells = [...at.querySelectorAll(`[data-column="${CSS.escape(id)}"]`)].filter(
      (cell) => cell.closest(`.${styles.grid}`) === at,
    );
    const width = Math.max(0, ...cells.map((cell) => cell.getBoundingClientRect().width));
    at.style.setProperty("--columns", gridColumns(columns));
    const room = box.clientWidth; // still all in view, scrolled to
    table.setColumnSizing((sizes) => ({ ...sizes, [id]: Math.ceil(Math.min(width, room)) }));
  };
  const rows = table.getRowModel().rows;
  // Only the rows near the view are drawn, of a list that scrolls itself; a tree's still within
  // the rows holding them, and those of a list part of a page, all of them.
  const virtual = !tree && !embedded;
  // The rows drawn, near the view, said as they are drawn, and again as the rows or what the
  // View asks change, e.g. a search starting (`VirtualRows` tells as either does).
  const drawnNow = (indexes: number[]) => {
    for (const index of indexes) {
      const row = rows[index];
      if (row !== undefined) seen?.(row.original);
    }
  };
  // Of the others: rows that come into view, or near it, said once each time they are drawn; all
  // of them where nothing tells, as in jsdom.
  useEffect(() => {
    if (seen === undefined || virtual) return;
    const drawn = rows.flatMap((row, index) => {
      const element = document.getElementById(`${list}-${index}`);
      return element ? [[element, row.original] as const] : [];
    });
    if (typeof IntersectionObserver === "undefined") {
      for (const [, row] of drawn) seen(row);
      return;
    }
    const byElement = new Map<Element, TData>(drawn);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const row = byElement.get(entry.target);
          if (entry.isIntersecting && row !== undefined) seen(row);
        }
      },
      { rootMargin: "200px 0px" },
    );
    for (const [element] of drawn) observer.observe(element);
    return () => observer.disconnect();
  });
  const filtered = table.state.columnFilters.length > 0;
  const columns = { "--columns": gridColumns(table.getVisibleLeafColumns()) };
  // A tree's rows by the row they are within, in order: those of rows open.
  const childrenOf = new Map<string, typeof rows>();
  for (const row of rows) {
    if (row.parentId === undefined) continue;
    const siblings = childrenOf.get(row.parentId);
    if (siblings) siblings.push(row);
    else childrenOf.set(row.parentId, [row]);
  }
  const indexOf = new Map(rows.map((row, index) => [row.id, index]));
  const drawRow = (row: (typeof rows)[number], drawn?: Drawn) => {
    const index = indexOf.get(row.id) ?? 0;
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
    // A tree's rows within this one, drawn inside it, so that an open row sticks while they scroll.
    const within = (tree && childrenOf.get(row.id)) || [];
    return (
      <li
        key={row.id}
        ref={drawn?.measure}
        data-index={drawn?.index}
        data-first={index === 0 || undefined}
        className={styles.item}
        data-tone={tone?.(row.original)}
        data-depth={row.depth || undefined}
        data-holding={within.length > 0 || undefined}
        style={cssVars(tree ? { "--depth": row.depth } : {})}
      >
        {/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: a shortcut for the mouse; its button opens it by keyboard */}
        <div
          id={id}
          className={styles.row}
          data-plain={still || undefined}
          data-showing={showing?.(row.original) || undefined}
          onClick={still ? undefined : (event) => clickRow(event, () => opening(event))}
          onAuxClick={view && ((event) => clickRow(event, () => middle(event)))}
          onContextMenu={rowMenu && ((event) => showRowMenu(event, row.original, row.id))}
          onPointerEnter={ahead && (() => ahead(row.original))}
          onFocus={ahead && (() => ahead(row.original))}
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
              {actions && cell.column.columnDef.meta?.identifies ? (
                <span className={styles.withActions}>
                  <span className={styles.named}>
                    <FlexRender cell={cell} />
                  </span>
                  <span className={styles.actions}>{actions(row.original)}</span>
                </span>
              ) : (
                <FlexRender cell={cell} />
              )}
            </span>
          ))}
          {rowMenuAt?.id === row.id && (
            <RowMenuAt
              at={rowMenuAt}
              anchor={rowAnchor}
              menu={rowMenu?.(row.original)}
              onClose={() => setRowMenuAt(null)}
            />
          )}
          {within.length > 0 && <span className={styles.seam} aria-hidden="true" />}
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
        {within.length > 0 && (
          <ol className={styles.within}>{within.map((inner) => drawRow(inner))}</ol>
        )}
      </li>
    );
  };
  return (
    <div
      ref={frame}
      className={`${styles.frame} ${className ?? ""}`}
      style={cssVars(vars ?? {})}
      data-stale={stale || undefined}
      data-layout={layout}
      data-embedded={embedded || undefined}
      data-one-line={oneLine || undefined}
      data-grouped={grouped || undefined}
      data-tree={tree || undefined}
      data-compact={compact || undefined}
    >
      <div ref={grid} className={styles.grid} style={cssVars(columns)}>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: a context menu, which the menu key opens from a header's buttons too */}
        <div
          {...dropProps}
          ref={head}
          className={styles.head}
          onContextMenu={layout === "columns" ? showMenu : undefined}
        >
          {layout === "lines" ? (
            <LinesHead
              table={table}
              filters={table.state.columnFilters}
              sorting={table.state.sorting}
              choices={choices}
            />
          ) : (
            table
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
                    moves={
                      arrangeable(header.column.columnDef) ? carried(header.column.id) : undefined
                    }
                    choices={choices[header.column.id]}
                    onFit={() => fitColumn(header.column.id)}
                  >
                    {typeof label === "string" ? label : undefined}
                  </ColumnHeader>
                );
              })
          )}
          {filtered && layout === "columns" && (
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
          {line !== null && (
            <span className={styles.dropLine} style={cssVars({ "--x": `${line}px` })} />
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
        {rows.length > 0 && virtual && (
          <VirtualRows
            source={table}
            count={rows.length}
            keyOf={(index) => rows[index]?.id ?? String(index)}
            scroller={(rows) => rows.closest("[data-layout]")}
            draw={(index, drawn) => {
              const row = rows[index];
              return row && drawRow(row, drawn);
            }}
            drawnNow={drawnNow}
            onPointerOver={showWholeText}
          />
        )}
        {rows.length > 0 && !virtual && (
          <ol className={styles.rows} onPointerOver={showWholeText}>
            {(tree ? rows.filter((row) => row.depth === 0) : rows).map((row) => drawRow(row))}
          </ol>
        )}
      </div>
      {message !== null && <p className={problem ? styles.problem : styles.quiet}>{message}</p>}
      {hasNextPage && (
        <p ref={end} className={styles.quiet}>
          {isFetchingNextPage ? `Loading older ${older}…` : `Older ${older} load as you scroll.`}
        </p>
      )}
    </div>
  );
}

/** A row's menu, opened where it was asked for in the row: at an anchor placed there. */
function RowMenuAt({
  at,
  anchor,
  menu,
  onClose,
}: {
  at: { x: number; y: number; keyboard: boolean };
  anchor: RefObject<HTMLSpanElement | null>;
  menu: { label: string; groups: RowAction[][] } | undefined;
  onClose: () => void;
}) {
  if (menu === undefined) return null;
  return (
    <>
      <span
        ref={anchor}
        className={styles.anchor}
        style={cssVars({ "--x": `${at.x}px`, "--y": `${at.y}px` })}
      />
      <RowMenu
        key={`${at.x} ${at.y}`} // opened anew where clicked again
        label={menu.label}
        groups={menu.groups}
        anchor={anchor}
        keyboard={at.keyboard}
        onClose={onClose}
      />
    </>
  );
}

/** What a cell says of its column, for its look. */
function cellData(column: { id: string; columnDef: { meta?: ColumnLook } }) {
  const meta = column.columnDef.meta;
  return {
    "data-column": column.id,
    "data-second": meta?.second || undefined,
    "data-figures": meta?.figures || undefined,
    "data-align": meta?.align,
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
