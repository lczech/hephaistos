import { useVirtualizer } from "@tanstack/react-virtual";
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
import { type Shape, type Stuck, stuckRows } from "./stuck";

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
}

/** What the List may ask of its rows: to bring one into view. */
export interface RowsHandle {
  scrollTo: (index: number) => void;
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
  drawnNow?: (indexes: number[]) => void; // after each draw, the rows drawn
  handle?: RefObject<RowsHandle | null>;
  onPointerOver?: (event: PointerEvent) => void;
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
  drawnNow,
  handle,
  onPointerOver,
}: Props) {
  const list = useRef<HTMLOListElement>(null);
  const strip = useRef<HTMLOListElement>(null);
  // Where the rows start in what scrolls them, below the header; where the header ends once it
  // stays, from where what scrolls them starts sticking, within its padding at the top (`pad`):
  // measured after each draw, as the header changes its height, e.g. its buttons wrapping.
  const [place, setPlace] = useState({ margin: 0, below: 0, pad: 0 });
  const guess = useRef(FIRST_GUESS);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => (list.current ? scroller(list.current) : null),
    // Until measured, as high as the window: so that the first draw shows rows, not none.
    initialRect: { width: 0, height: window.innerHeight },
    estimateSize: () => guess.current,
    overscan: 12,
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
  });
  const items = virtualizer.getVirtualItems();

  useLayoutEffect(() => {
    const at = list.current;
    const box = at && scroller(at);
    if (!box || !at) return;
    const top = at.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    const pad = Number.parseFloat(getComputedStyle(box).paddingTop) || 0;
    const next = { margin: top, below: below?.() ?? 0, pad };
    const moved = (["margin", "below", "pad"] as const).some(
      (key) => Math.abs(next[key] - place[key]) > 0.01,
    );
    if (moved) setPlace(next);
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
  const stuckNow = (): Stuck[] => {
    if (shape === undefined || shape.depth.length !== count) return [];
    const measures = virtualizer.measurementsCache;
    const scrolled = virtualizer.scrollElement?.scrollTop ?? 0;
    const line = Math.max(place.margin, scrolled + place.pad + place.below);
    const height = (index: number) => {
      const item = measures[index];
      return own.current.get(String(item?.key)) ?? item?.size ?? guess.current;
    };
    return stuckRows(measures, shape, line, height, offsetOf);
  };
  const stuck = stuckNow();
  // The rows stuck move as the list scrolls, within the rows drawn too, of which the virtualizer
  // says nothing: drawn anew, before the list is painted, as they change.
  const [, setStuckKey] = useState("");
  useEffect(() => {
    const box = virtualizer.scrollElement;
    if (box === null || shape === undefined) return;
    const scrolled = () => {
      const now = stuckNow()
        .map((at) => `${at.index}@${at.top}`)
        .join(" ");
      flushSync(() => setStuckKey(now));
    };
    box.addEventListener("scroll", scrolled, { passive: true });
    return () => box.removeEventListener("scroll", scrolled);
  });
  // A copy is seen, not reached: neither by Tab nor by screen readers.
  useLayoutEffect(() => {
    for (const element of strip.current?.querySelectorAll<HTMLElement>(
      "a[href], button, input, select, textarea, [tabindex]",
    ) ?? []) {
      element.tabIndex = -1;
    }
  });
  // A copy clicked: its row scrolled to where the copy is, at the top, for the List to close it.
  const placeOf = (at: Stuck) => () => {
    const [box, item] = [virtualizer.scrollElement, virtualizer.measurementsCache[at.index]];
    if (box && item)
      box.scrollTop = item.start + offsetOf(at.index) - place.pad - place.below - at.top;
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

  if (handle) {
    handle.current = {
      scrollTo: (index) => virtualizer.scrollToIndex(index, { align: "auto" }),
    };
  }

  // Once, not anew on each draw, which would size and place all rows drawn again.
  const [containerRef] = useState(() => (element: HTMLOListElement | null) => {
    list.current = element;
    virtualizer.containerRef(element);
  });

  // The copies lie on the background, from just above the line, below the header's edge, to the
  // end of the lowest.
  const end = Math.max(0, ...stuck.map((at) => at.top + at.height));
  return (
    <>
      {shape && (
        <ol
          ref={strip}
          className={styles.stuck}
          aria-hidden="true"
          onMouseDown={(event) => event.preventDefault()} // the focus stays where it is
          style={cssVars({ "--stuck-top": `${place.below}px`, "--stuck-end": `${end}px` })}
          data-empty={stuck.length === 0 || undefined}
          onPointerOver={onPointerOver}
        >
          {stuck.map((at) =>
            draw(at.index, { index: at.index, copy: { top: at.top, place: placeOf(at) } }),
          )}
        </ol>
      )}
      <ol
        ref={containerRef}
        className={`${styles.rows} ${styles.virtual}`}
        onPointerOver={onPointerOver}
      >
        {items.map((item) =>
          draw(item.index, { index: item.index, measure: virtualizer.measureElement }),
        )}
      </ol>
    </>
  );
}
