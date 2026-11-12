import { FlexRender, type ReactTable, type RowData } from "@tanstack/react-table";
import { ChevronRight, FunnelX } from "lucide-react";
import {
  type HTMLAttributes,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
  type RefObject,
  useEffect,
  useId,
  useImperativeHandle,
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
import { shapeOf } from "./stuck";
import type { ListFeatures } from "./table";
import { type Drawn, type RowsHandle, VirtualRows } from "./VirtualRows";

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

/** What a View may ask of its List. */
export interface ListHandle {
  /** Brings the row of this ID into view, drawn first if it is not; false if it has none. */
  scrollTo: (id: string) => boolean;
  /** Whether the row of this ID is drawn, near the view. */
  drawn: (id: string) => boolean;
}

/** Of an endless list: whether there is more, and how to get it (as TanStack Query's). */
interface Paging {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
}

interface Props<TData extends RowData> {
  table: ReactTable<ListFeatures, TData>;
  label: string; // what screen readers call it: `Files`, `Events`
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
  handle?: RefObject<ListHandle | null>;
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
 * Only the rows near the view are drawn (`VirtualRows`). A row whose content is open, its
 * details or, as a `tree`, the rows within it, stays in view below the header and the rows
 * holding it while that content scrolls past; part of a page, at the top of what scrolls it. As
 * a `tree`, its square is as narrow as its chevrons. A row may have actions after what names it,
 * shown while it is pointed at or focused, and a menu (the right button, or the menu key: its
 * first item focused then); `ahead` is called as a row is pointed at or focused, to ask for what
 * opening it shows, `seen` as it is drawn, near the view, to ask for what it shows.
 * `compact` rows stand closer together.
 */
export function List<TData extends RowData>({
  table,
  label,
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
  handle,
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
    copy: boolean; // asked for on its copy stuck, not on the row itself
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
  const showRowMenu = (
    event: MouseEvent<HTMLDivElement>,
    row: TData,
    id: string,
    copy: boolean,
  ) => {
    if (rowMenu?.(row) === undefined) return;
    event.preventDefault();
    const box = event.currentTarget.getBoundingClientRect();
    const keyboard = event.clientX === 0 && event.clientY === 0;
    const [x, y] = keyboard ? [0, box.height] : [event.clientX - box.left, event.clientY - box.top];
    setRowMenuAt({ id, x, y, keyboard, copy });
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
  // The rows drawn, near the view, said as they are drawn, and again as the rows or what the
  // View asks change, e.g. a search starting (`VirtualRows` tells as either does).
  const drawnNow = (indexes: number[]) => {
    for (const index of indexes) {
      const row = rows[index];
      if (row !== undefined) seen?.(row.original);
    }
  };
  const filtered = table.state.columnFilters.length > 0;
  const columns = { "--columns": gridColumns(table.getVisibleLeafColumns()) };
  // The rows that rows shown are within: those open, of a tree.
  const holding = new Set(
    rows.flatMap((row) => (row.parentId === undefined ? [] : [row.parentId])),
  );
  const indexOf = new Map(rows.map((row, index) => [row.id, index]));
  // Of each row, where it stands among the rows beside it, those within the same row, and how
  // many they are: for screen readers, as only the rows near the view are drawn.
  const siblings = new Map<string, number>();
  const placeAmong = rows.map((row) => {
    const at = (siblings.get(row.parentId ?? "") ?? 0) + 1;
    siblings.set(row.parentId ?? "", at);
    return at;
  });
  const rowsHandle = useRef<RowsHandle>(null);
  useImperativeHandle(handle, () => ({
    scrollTo: (id) => {
      const index = indexOf.get(id);
      if (index === undefined) return false;
      rowsHandle.current?.scrollTo(index);
      return true;
    },
    drawn: (id) => {
      const index = indexOf.get(id);
      return index !== undefined && (rowsHandle.current?.drawn(index) ?? false);
    },
  }));
  // Whether a row's content is open: in a tree, the rows within it; else its details.
  const holds = (row: (typeof rows)[number]) =>
    folds?.(row.original)
      ? tree === true && row.getIsExpanded() && holding.has(row.id)
      : open.has(row.id) && opens?.(row.original) === undefined && !plain?.(row.original);
  // Which rows stick while their content scrolls past: of a tree by its levels, else each alone.
  const shape = shapeOf(rows.map((row) => ({ depth: tree ? row.depth : 0, holds: holds(row) })));
  // Where the header ends while it stays at the top as the list scrolls, from where it sticks
  // (within the list's padding): for the rows stuck below it. Part of a page, the list sticks
  // nothing above them: they stay at the top of what scrolls the page.
  const below = () => {
    const at = head.current;
    if (at === null || embedded) return 0;
    return at.getBoundingClientRect().height + (Number.parseFloat(getComputedStyle(at).top) || 0);
  };
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
    // A copy stuck, clicked, scrolls its row to where it is, then closes it, as its row would.
    const copy = drawn?.copy;
    if (copy) {
      const closing = opening;
      opening = (click) => {
        copy.place();
        closing(click);
      };
    }
    const id = `${list}-${index}`; // a row's ID may be any text, so not in IDs
    const [first, ...others] = row.getVisibleCells();
    return (
      <Row
        key={row.id}
        ref={drawn?.measure}
        aria-rowindex={index + 2} // after the header's
        aria-level={row.depth + 1}
        aria-posinset={placeAmong[index]}
        aria-setsize={siblings.get(row.parentId ?? "")}
        aria-expanded={still || view ? undefined : shown}
        data-index={copy ? undefined : drawn?.index}
        data-first={index === 0 || undefined}
        className={styles.item}
        data-tone={tone?.(row.original)}
        data-depth={row.depth || undefined}
        data-holding={holds(row) || undefined}
        style={cssVars({
          ...(tree ? { "--depth": row.depth } : {}),
          ...(copy ? { "--top": `${copy.top}px` } : {}),
        })}
      >
        {/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: a shortcut for the mouse; its button opens it by keyboard */}
        <div
          id={copy ? undefined : id}
          className={styles.row}
          data-plain={still || undefined}
          data-showing={showing?.(row.original) || undefined}
          onClick={still ? undefined : (event) => clickRow(event, () => opening(event))}
          onAuxClick={view && ((event) => clickRow(event, () => middle(event)))}
          onContextMenu={
            rowMenu && ((event) => showRowMenu(event, row.original, row.id, copy !== undefined))
          }
          onPointerEnter={ahead && (() => ahead(row.original))}
          onFocus={ahead && (() => ahead(row.original))}
        >
          {first && still && (
            <Cell {...cellData(first.column)}>
              <FlexRender cell={first} />
            </Cell>
          )}
          {first && !still && (
            <Cell {...cellData(first.column)}>
              <button
                type="button"
                className={styles.open}
                aria-expanded={view ? undefined : shown} // as the row's, as a button that opens it
                aria-controls={shown && !folding && !view && !copy ? `${id}-details` : undefined}
                aria-labelledby={copy ? undefined : id}
                title={squareTitle?.(row.original)}
                onClick={opening}
                onAuxClick={view && middle}
              >
                <FlexRender cell={first} />
              </button>
            </Cell>
          )}
          {others.map((cell) => (
            <Cell key={cell.id} {...cellData(cell.column)}>
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
            </Cell>
          ))}
          {rowMenuAt?.id === row.id && rowMenuAt.copy === (copy !== undefined) && (
            <RowMenuAt
              at={rowMenuAt}
              anchor={rowAnchor}
              menu={rowMenu?.(row.original)}
              onClose={() => setRowMenuAt(null)}
            />
          )}
        </div>
        {shown && !folding && !still && !view && !copy && (
          <Cell block className={styles.details} data-bare={bareDetails || undefined}>
            <section id={`${id}-details`} aria-label={detailsLabel}>
              {details(row.original)}
            </section>
          </Cell>
        )}
      </Row>
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
      <div
        ref={grid}
        role="treegrid"
        aria-label={label}
        aria-rowcount={rows.length + 1} // the header too
        className={styles.grid}
        style={cssVars(columns)}
      >
        {/* biome-ignore lint/a11y/useSemanticElements lint/a11y/useFocusableInteractive: a treegrid's header row, laying out its columns on its own, not as a table's; its buttons take the focus */}
        <div
          {...dropProps}
          ref={head}
          role="row"
          aria-rowindex={1}
          className={styles.head}
          onContextMenu={layout === "columns" ? showMenu : undefined}
        >
          {layout === "lines" ? (
            <HeaderCell>
              <LinesHead
                table={table}
                filters={table.state.columnFilters}
                sorting={table.state.sorting}
                choices={choices}
              />
            </HeaderCell>
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
            <HeaderCell>
              <button
                type="button"
                className={styles.clear}
                onClick={() => table.resetColumnFilters(true)}
                title="Clear all filters"
                aria-label="Clear all filters"
              >
                <FunnelX aria-hidden="true" />
              </button>
            </HeaderCell>
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
        {rows.length > 0 && (
          <VirtualRows
            source={table}
            count={rows.length}
            keyOf={(index) => rows[index]?.id ?? String(index)}
            scroller={(rows) => {
              const list = rows.closest<HTMLElement>("[data-layout]");
              return embedded ? scrollerOf(list?.parentElement ?? null) : list;
            }}
            sticky={!embedded}
            draw={(index, drawn) => {
              const row = rows[index];
              return row && drawRow(row, drawn);
            }}
            shape={shape}
            below={below}
            drawnNow={drawnNow}
            handle={rowsHandle}
            onPointerOver={showWholeText}
          />
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

/** A treegrid's row: its own cells, and below them its details. */
function Row(props: HTMLAttributes<HTMLDivElement> & { ref?: Ref<HTMLDivElement> }) {
  // biome-ignore lint/a11y/useSemanticElements lint/a11y/useFocusableInteractive: a treegrid's row, as each row lays out its columns on its own, not as a table's
  return <div role="row" {...props} />;
}

/**
 * A treegrid's cell: a row's, or below it, its details (`block`). Not focusable itself: the keys
 * move between rows, and Tab through what a row holds.
 */
function Cell({ block, ...props }: { block?: boolean } & HTMLAttributes<HTMLElement>) {
  // biome-ignore lint/a11y/useFocusableInteractive lint/a11y/useSemanticElements: a treegrid's cell, as each row lays out its columns on its own, not as a table's
  return block ? <div role="gridcell" {...props} /> : <span role="gridcell" {...props} />;
}

/** A cell of the header around what lays out as the header's own, e.g. its buttons in lines. */
function HeaderCell({ children }: { children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/useFocusableInteractive lint/a11y/useSemanticElements: a treegrid's header cell, as the header lays out its columns on its own, not as a table's
    <span role="columnheader" className={styles.contents}>
      {children}
    </span>
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

/** The element that scrolls `element`: the nearest around it that scrolls up and down. */
function scrollerOf(element: HTMLElement | null): HTMLElement | null {
  for (let at = element; at !== null; at = at.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(at).overflowY)) return at;
  }
  return null;
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
