import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import {
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { cssVars } from "../cssVars";
import styles from "./list.module.css";
import { rowAt, type Shape, type Stuck, stuckRows } from "./stuck";

// Not compiled by React's compiler (`web/vite.config.ts`): it refuses TanStack Virtual's
// `useVirtualizer`, whose virtualizer stays the same object as what it shows changes. Drawn anew
// each time instead, as TanStack Virtual expects: as the List is, as the rows in view change, and
// as the rows stuck move.

/**
 * How the List draws a row here: measured, at its index among all rows; or a copy of it, stuck
 * at `top` from the line below the header, which a click first scrolls to its place (`place`).
 */
export interface Drawn {
  index: number;
  measure?: (element: Element | null) => void;
  copy?: { top: number; place: () => void };
  entry?: boolean; // where Tab enters the rows: the row focused, else the first in view
}

/**
 * What the List may ask of its rows: to bring one into view, drawn first if it is not, at the
 * nearest edge or at the top; the row a page away from one, up or down; whether one is drawn.
 */
export interface RowsHandle {
  scrollTo: (index: number, at?: "nearest" | "start") => void;
  page: (index: number, by: 1 | -1) => number;
  drawn: (index: number) => boolean;
}

interface Props {
  // What the rows are drawn from, e.g. the List's table: new whenever what they show may change,
  // so that they are drawn anew, as `draw` reads it as it draws, e.g. the columns shown.
  source: unknown;
  count: number;
  keyOf: (index: number) => string;
  // The element that scrolls them, from their own: not a ref of the List's, which is set only
  // after their first draw, as an element around them.
  scroller: (rows: HTMLElement) => HTMLElement | null;
  draw: (index: number, drawn: Drawn) => ReactNode;
  // Which rows hold others or their details open, which stick while those scroll past, below
  // where the header ends in what scrolls them (`below`); none stick without it.
  shape?: Shape;
  below?: () => number;
  // Whether the rows stuck stay by CSS's sticking, as in a list that scrolls itself; else, as in
  // one part of a page whose frame scrolls sideways, the box sticking would hold to, they are
  // moved as the page scrolls.
  sticky?: boolean;
  // A row of the View's own, below the header once the rows scroll under it, from the row at the
  // top, if it gives one: drawn over the rows, those stuck and those gone to coming below it.
  // Only where the rows stick by CSS.
  // With the row below, `next`, while it comes in under it: how far down the band it starts.
  band?: (index: number, next?: Next) => ReactNode;
  drawnNow?: (indexes: number[]) => void; // after each draw, the rows drawn
  handle?: RefObject<RowsHandle | null>;
  focus?: number; // the row focused, kept drawn while scrolled away, so as to keep the focus
  onPointerOver?: (event: PointerEvent) => void;
}

/** The row below the band's, coming in under it: where it starts, down from the band's top, and
 * how high the band is, out of which it pushes what it ends as it rises. */
export interface Next {
  index: number;
  at: number;
  height: number;
}

/** Of rows not measured yet, the height guessed: the last measured, at first a row's. */
const FIRST_GUESS = 22;

/**
 * A list's rows, only those near the view drawn (TanStack Virtual), each measured as drawn and
 * placed by `top`. Rows in view stay where they are as rows come or go before them, unless the
 * list is scrolled to its very top, where new rows show.
 *
 * A row whose content is open (the rows within it, its details) stays in view below the header,
 * and below the rows holding it, while that content scrolls past, as VS Code's sticky scroll:
 * a copy, drawn apart above the rows, on one block of the background, so that no seam of the rows
 * passing below shows between two; sliding out as the end of its content pushes it up.
 */
export function VirtualRows({
  source: _,
  count,
  keyOf,
  scroller,
  draw,
  shape,
  below,
  sticky = true,
  band,
  drawnNow,
  handle,
  focus,
  onPointerOver,
}: Props) {
  const list = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const banded = useRef<HTMLDivElement>(null);
  // Where the rows start in what scrolls them, below the header; where the header ends once it
  // stays, from where what scrolls them starts sticking, within its padding at the top (`pad`):
  // measured after each draw, as the header changes its height, e.g. its buttons wrapping.
  const [place, setPlace] = useState({ margin: 0, below: 0, pad: 0 });
  const guess = useRef(FIRST_GUESS);
  const stuckMoved = useRef<(() => void) | null>(null);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => (list.current ? scroller(list.current) : null),
    // Until measured, as high as the window: so that the first draw shows rows, not none.
    initialRect: { width: 0, height: window.innerHeight },
    estimateSize: () => guess.current,
    overscan: 12,
    rangeExtractor: (range) => {
      const drawn = defaultRangeExtractor(range);
      if (focus === undefined || focus >= range.count || drawn.includes(focus)) return drawn;
      return [...drawn, focus].sort((a, b) => a - b);
    },
    scrollMargin: place.margin,
    getItemKey: keyOf,
    // As high as drawn, not rounded to pixels as TanStack's own measure is: else each row lies a
    // fraction of a pixel further down, rows of 18.84 px 19 px apart.
    // The guess is the row's own height, not that of its details.
    measureElement: (element, entry) => {
      const height = entry?.borderBoxSize[0]?.blockSize ?? element.getBoundingClientRect().height;
      // Measured alike where it is the row alone: a guess off by a hair moves the rows in view.
      const row = element.childElementCount > 1 ? element.firstElementChild : null;
      const own = row?.getBoundingClientRect().height ?? height;
      if (own > 0) guess.current = own;
      return height;
    },
    // Rows moved as measured without React, drawn anew only as the range drawn changes; by `top`,
    // as text moved by `transform` to a fraction of a pixel, as rows of 18.84 px are, is blurred.
    directDomUpdates: true,
    directDomUpdatesMode: "position",
    // Rows measured anew, e.g. details growing after drawing: the rows stuck may move.
    onChange: () => stuckMoved.current?.(),
  });
  const items = virtualizer.getVirtualItems();

  // Measured anew after each draw, and as what scrolls them scrolls or changes its height, as
  // what lies before the rows in a page may, e.g. diffs drawn.
  /** Measures where the list lies, and says whether that moved. */
  const measurePlace = (sync = false): boolean => {
    const at = list.current;
    const box = at && scroller(at);
    if (!box || !at) return false;
    const top = at.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    const pad = sticky ? Number.parseFloat(getComputedStyle(box).paddingTop) || 0 : 0;
    const next = { margin: top, below: below?.() ?? 0, pad };
    const moved = (["margin", "below", "pad"] as const).some(
      (key) => Math.abs(next[key] - place[key]) > 0.01,
    );
    if (moved && sync) flushSync(() => setPlace(next));
    else if (moved) setPlace(next);
    return moved;
  };
  useLayoutEffect(() => {
    measurePlace();
  });
  useEffect(() => {
    const box = virtualizer.scrollElement;
    const around = list.current?.parentElement; // the header too, which may wrap, narrowed
    if (box === null || !around) return;
    const observer = new ResizeObserver(() => measurePlace());
    observer.observe(around);
    if (!sticky) for (const child of box.children) observer.observe(child);
    return () => observer.disconnect();
  });

  // The height of each row itself, without its details, by its key: as drawn, else as measured;
  // and where it starts in its room, below what stands above it there, e.g. a group's line.
  const own = useRef(new Map<string, number>());
  const ownTop = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    for (const item of items) {
      const room = virtualizer.elementsCache.get(item.key);
      const row = room?.firstElementChild;
      if (!room || !row) continue;
      const box = row.getBoundingClientRect();
      own.current.set(String(item.key), box.height);
      ownTop.current.set(String(item.key), box.top - room.getBoundingClientRect().top);
    }
  });
  const offsetOf = (index: number) =>
    ownTop.current.get(String(virtualizer.measurementsCache[index]?.key)) ?? 0;
  // The band's height, as drawn, also while it is not shown: for the rows gone to below it.
  const bandHeight = useRef(0);
  useLayoutEffect(() => {
    bandHeight.current = banded.current?.getBoundingClientRect().height ?? 0;
  });
  const banding = band !== undefined && sticky;
  // Where the header ends, in what scrolls them; the band's row: the one there, once the rows
  // scroll under the header, if it gives a band.
  const headerLine = () => (virtualizer.scrollElement?.scrollTop ?? 0) + place.pad + place.below;
  const bandIndex = () => {
    const line = headerLine();
    if (!banding || line <= place.margin + 0.5) return undefined;
    // A pixel down, as scrolling goes by whole pixels: not the row above, a fraction showing.
    return rowAt(virtualizer.measurementsCache, line + 1);
  };
  // With the row below, while it starts within the band, as it comes in under it.
  const bandPlace = (): { index: number; next?: Next } | undefined => {
    const index = bandIndex();
    const below = index === undefined ? undefined : virtualizer.measurementsCache[index + 1];
    if (index === undefined || below === undefined)
      return index === undefined ? undefined : { index };
    const at = below.start + offsetOf(index + 1) - headerLine();
    const height = bandHeight.current;
    return at > 0 && at < height ? { index, next: { index: index + 1, at, height } } : { index };
  };
  const bandAt = bandIndex();
  const bandShown = bandAt === undefined ? null : band?.(bandAt);
  const shownBand = bandShown !== null && bandShown !== undefined ? bandHeight.current : 0;
  // Where the rows scroll by below the header and the band, in what scrolls them.
  const stuckLine = () => Math.max(place.margin, headerLine() + shownBand);
  const stuckNow = (): Stuck[] => {
    if (shape === undefined || shape.depth.length !== count) return [];
    const measures = virtualizer.measurementsCache;
    const height = (index: number) => {
      const item = measures[index];
      return own.current.get(String(item?.key)) ?? item?.size ?? guess.current;
    };
    return stuckRows(measures, shape, stuckLine(), height, offsetOf);
  };
  const stuck = stuckNow();
  const stuckEnd = Math.max(0, ...stuck.map((at) => at.top + at.height));
  // The rows stuck move as the list scrolls, within the rows drawn too, of which the virtualizer
  // says nothing: drawn anew, before the list is painted, as they change.
  const [, setStuckKey] = useState("");
  const stuckKey = () =>
    `${stuckNow()
      .map((at) => `${at.index}@${at.top}`)
      .join(" ")} ${bandIndex() ?? ""}`;
  // Where they do not stick by CSS, moved to the line as the page scrolls: by hand, as each
  // scroll moves it, not by drawing the rows anew.
  const placeStrip = () => {
    if (!sticky) strip.current?.style.setProperty("--stuck-top", `${stuckLine() - place.margin}px`);
  };
  useLayoutEffect(placeStrip);
  useEffect(() => {
    stuckMoved.current = shape === undefined ? null : () => setStuckKey(stuckKey());
    const box = virtualizer.scrollElement;
    if (box === null || shape === undefined) return;
    const scrolled = () => {
      const moved = !sticky && measurePlace(true); // then placed as drawn anew, by its effect
      flushSync(() => setStuckKey(stuckKey()));
      if (!moved) placeStrip();
    };
    box.addEventListener("scroll", scrolled, { passive: true });
    return () => box.removeEventListener("scroll", scrolled);
  });
  // A copy is seen, not reached: neither by Tab nor by screen readers.
  useLayoutEffect(() => {
    for (const copies of [strip.current, banded.current]) {
      for (const element of copies?.querySelectorAll<HTMLElement>(
        "a[href], button, input, select, textarea, [tabindex]",
      ) ?? []) {
        element.tabIndex = -1;
      }
    }
  });
  // A copy clicked: its row scrolled to where the copy is, at the top, for the List to close it.
  const placeOf = (at: Stuck) => () => {
    const [box, item] = [virtualizer.scrollElement, virtualizer.measurementsCache[at.index]];
    if (box && item)
      box.scrollTop =
        item.start + offsetOf(at.index) - place.pad - place.below - shownBand - at.top;
  };

  // The row first in view, by its key, and how far it is scrolled past: found again after a draw
  // in which rows came or went before it, the list not scrolled since, it is put back where it
  // was. A draw as the list scrolls, before the scroll is told here, keeps it where scrolled.
  // Gone itself, the row after it is put where that was.
  const anchor = useRef<{ keys: string[]; past: number[]; scrolled: number } | null>(null);
  const keep = () => {
    const offset = virtualizer.scrollElement?.scrollTop ?? 0; // the virtualizer's, a frame late
    const item = virtualizer.getVirtualItemForOffset(offset);
    const next = item && virtualizer.measurementsCache[item.index + 1];
    anchor.current =
      offset > place.margin && item
        ? {
            keys: [String(item.key), String(next?.key)],
            past: [offset - item.start, offset - (next?.start ?? 0)],
            scrolled: offset,
          }
        : null;
  };
  useLayoutEffect(() => {
    const [was, box] = [anchor.current, virtualizer.scrollElement];
    if (was !== null && box !== null && box.scrollTop === was.scrolled) {
      const measures = virtualizer.measurementsCache;
      const there = new Set(measures.map((measure) => String(measure.key)));
      const found = was.keys.findIndex((key) => there.has(key));
      const item = measures.find((measure) => measure.key === was.keys[found]);
      const to = item && item.start + (was.past[found] ?? 0);
      if (to !== undefined && Math.abs(to - box.scrollTop) > 0.5) box.scrollTop = to;
    }
    keep();
  });
  useEffect(() => {
    const box = virtualizer.scrollElement;
    if (box === null) return;
    box.addEventListener("scroll", keep, { passive: true });
    return () => box.removeEventListener("scroll", keep);
  });

  const drawnKeys = items.map((item) => item.index).join(" ");
  useEffect(() => {
    drawnNow?.(drawnKeys === "" ? [] : drawnKeys.split(" ").map(Number));
  }, [drawnKeys, drawnNow]);

  // A row asked for comes into view, by as little as it takes: below the header and the rows
  // that would stick above it, those holding it. Tried again after each draw for a while, as rows
  // drawn on the way are measured, and move it; by its key, as rows may come or go before it.
  const asked = useRef<{ key: string; tries: number; start: boolean } | null>(null);
  const bringIntoView = () => {
    const [box, at] = [virtualizer.scrollElement, asked.current];
    if (box === null || at === null) return;
    const measures = virtualizer.measurementsCache;
    const index = measures.findIndex((measure) => String(measure.key) === at.key);
    const item = measures[index];
    if (item === undefined || at.tries-- <= 0) {
      asked.current = null;
      return;
    }
    const height = (index: number) => {
      const measure = measures[index];
      return own.current.get(String(measure?.key)) ?? measure?.size ?? guess.current;
    };
    // Below the band too, but at the very top, where it is not shown.
    let above = place.pad + place.below + (banding && index > 0 ? bandHeight.current : 0);
    for (let up = shape?.parent[index] ?? -1; up >= 0; up = shape?.parent[up] ?? -1) {
      if (shape?.holds[up]) above += height(up);
    }
    const top = box.scrollTop + above;
    const bottom = box.scrollTop + box.clientHeight;
    // The row itself, below what stands above it in its room, e.g. a group's line.
    const end = item.start + offsetOf(index) + height(index);
    // Rounded so that the whole row shows where scrolling goes by whole pixels, as in WebKit:
    // down to its top, up to its bottom.
    let to: number | undefined;
    if (index === 0)
      to = 0; // the first, at the very top
    else if (at.start || item.start < top) to = Math.floor(item.start - above);
    else if (end > bottom) to = Math.ceil(end - box.clientHeight);
    if (to === undefined || Math.abs(to - box.scrollTop) < 0.5) {
      asked.current = null;
      return;
    }
    box.scrollTop = to;
    // Again once drawn there, as rows drawn on the way are measured: drawn anew by React only as
    // the range drawn changes.
    requestAnimationFrame(bringIntoView);
  };
  useLayoutEffect(bringIntoView);
  // The row a page from this one: as far as the rows in view reach, below those stuck.
  const page = (index: number, by: 1 | -1) => {
    const [box, measures] = [virtualizer.scrollElement, virtualizer.measurementsCache];
    const item = measures[index];
    if (box === null || item === undefined) return index;
    // From the row's own top: the details below it count as the rows do. At least a row on.
    const room = Math.max(
      box.clientHeight - place.pad - place.below - shownBand - stuckEnd,
      guess.current,
    );
    const at = rowAt(measures, item.start + by * room) ?? (by > 0 ? count - 1 : 0);
    const moved = by > 0 ? at > index : at < index;
    return moved ? at : Math.min(Math.max(index + by, 0), count - 1);
  };
  if (handle) {
    handle.current = {
      scrollTo: (index, where = "nearest") => {
        asked.current = { key: keyOf(index), tries: 5, start: where === "start" };
        bringIntoView();
      },
      page,
      drawn: (index) => virtualizer.getVirtualItems().some((item) => item.index === index),
    };
  }
  // Where Tab enters the rows: the row focused, else the first in view, below those stuck.
  const firstInView = () => {
    const measures = virtualizer.measurementsCache;
    const y = stuckLine() + stuckEnd;
    const at = rowAt(measures, y);
    if (at === undefined) return 0;
    // Cut off at the top, the next, if that is in view: else this one, its details filling it.
    const next = measures[at + 1];
    const bottom =
      (virtualizer.scrollElement?.scrollTop ?? 0) + (virtualizer.scrollElement?.clientHeight ?? 0);
    return (measures[at]?.start ?? 0) < y - 1 && next !== undefined && next.start < bottom
      ? at + 1
      : at;
  };
  const entry = focus ?? firstInView();
  // Only the row Tab enters reaches by Tab what it holds: its links, its actions, its details;
  // those of the other rows drawn are left out, to come back once their row is focused. Also what
  // comes into them later, e.g. a diff's buttons once it is drawn, in its shadow DOM too.
  const untab = () => {
    for (const item of virtualizer.getVirtualItems()) {
      const row = virtualizer.elementsCache.get(item.key);
      if (!(row instanceof HTMLElement)) continue;
      const own = item.index === entered.current;
      for (const scope of scopesOf(row)) {
        for (const element of scope.querySelectorAll<HTMLElement>(TABBABLE)) {
          // Its own `tabindex` kept aside, if any, to have it back.
          const kept = element.dataset.untabbed;
          if (own && kept !== undefined) {
            if (kept === "") element.removeAttribute("tabindex");
            else element.setAttribute("tabindex", kept);
            delete element.dataset.untabbed;
          } else if (!own && kept === undefined) {
            element.dataset.untabbed = element.getAttribute("tabindex") ?? "";
            element.tabIndex = -1;
          }
        }
      }
    }
  };
  const entered = useRef(entry);
  entered.current = entry;
  useLayoutEffect(untab);
  useEffect(() => {
    const rows = list.current;
    if (rows === null) return;
    let asked = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(asked);
      asked = requestAnimationFrame(untab);
    });
    for (const scope of scopesOf(rows)) {
      observer.observe(scope, { childList: true, subtree: true });
    }
    return () => {
      cancelAnimationFrame(asked);
      observer.disconnect();
    };
  });

  // Once, not anew on each draw, which would size and place all rows drawn again.
  const [containerRef] = useState(() => (element: HTMLDivElement | null) => {
    list.current = element;
    virtualizer.containerRef(element);
  });

  // The copies lie on the background, from just above the line, below the header's edge, to the
  // end of the lowest.
  const end = stuckEnd;
  return (
    <>
      {banding && (
        <div
          className={styles.band}
          aria-hidden="true"
          style={cssVars({ "--stuck-top": `${place.below}px` })}
          data-shown={shownBand > 0 || undefined}
          onPointerOver={onPointerOver}
        >
          <div ref={banded} className={styles.banded}>
            {shownBand > 0 && (
              <BandRow
                place={bandPlace}
                draw={(at) => band?.(at.index, at.next)}
                scroller={virtualizer.scrollElement}
              />
            )}
          </div>
        </div>
      )}
      {shape && (
        <div
          ref={strip}
          className={styles.stuck}
          aria-hidden="true"
          onMouseDown={(event) => event.preventDefault()} // the focus stays where it is
          style={cssVars({
            // Sticking, below where the header and the band end; else moved to the line
            // (`placeStrip`).
            ...(sticky ? { "--stuck-top": `${place.below + shownBand}px` } : {}),
            "--stuck-end": `${end}px`,
          })}
          data-empty={stuck.length === 0 || undefined}
          data-placed={!sticky || undefined}
          onPointerOver={onPointerOver}
        >
          {stuck.map((at) =>
            draw(at.index, { index: at.index, copy: { top: at.top, place: placeOf(at) } }),
          )}
        </div>
      )}
      {/* biome-ignore lint/a11y/useSemanticElements: a treegrid's rows, each laying out its columns on its own, not as a table's */}
      <div
        ref={containerRef}
        role="rowgroup"
        className={`${styles.rows} ${styles.virtual}`}
        onPointerOver={onPointerOver}
      >
        {items.map((item) =>
          draw(item.index, {
            index: item.index,
            measure: virtualizer.measureElement,
            entry: item.index === entry,
          }),
        )}
      </div>
    </>
  );
}

/**
 * The band's row, drawn anew as the list scrolls while the row below comes in under it, so that
 * what it brings, e.g. a tip, slides in: apart from the rows, which are drawn anew only as the
 * row at the top changes.
 */
function BandRow({
  place,
  draw,
  scroller,
}: {
  place: () => { index: number; next?: Next } | undefined;
  draw: (at: { index: number; next?: Next }) => ReactNode;
  scroller: Element | null;
}) {
  const [, setKey] = useState("");
  // Where the band is, as the list now says: looked up on each scroll, listened to once.
  const placed = useRef(place);
  placed.current = place;
  useEffect(() => {
    if (scroller === null) return;
    const scrolled = () => {
      const at = placed.current();
      flushSync(() => setKey(at ? `${at.index} ${at.next?.at ?? ""}` : ""));
    };
    scroller.addEventListener("scroll", scrolled, { passive: true });
    return () => scroller.removeEventListener("scroll", scrolled);
  }, [scroller]);
  const at = place();
  return at ? draw(at) : null;
}

/** What may take the focus by Tab, or did before it was left out (`data-untabbed`). */
const TABBABLE =
  "a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1']), [data-untabbed]";

/** An element and the shadow roots within it: where its rows' controls may lie. */
function scopesOf(element: HTMLElement): (HTMLElement | ShadowRoot)[] {
  const roots = [...element.querySelectorAll("*")].flatMap((within) =>
    within.shadowRoot ? [within.shadowRoot] : [],
  );
  return [element, ...roots];
}
