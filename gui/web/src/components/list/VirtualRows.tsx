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
import styles from "./list.module.css";

// Not compiled by React's compiler (`web/vite.config.ts`): it refuses TanStack Virtual's
// `useVirtualizer`, whose virtualizer stays the same object as what it shows changes. Drawn anew
// each time instead, as TanStack Virtual expects: as the List is, and as the rows in view change.

/** How the List draws a row here: measured, at its index among all rows. */
export interface Drawn {
  index: number;
  measure: (element: Element | null) => void;
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
 */
export function VirtualRows({
  source: _,
  count,
  keyOf,
  scroller,
  draw,
  drawnNow,
  handle,
  onPointerOver,
}: Props) {
  const list = useRef<HTMLOListElement>(null);
  // Where the rows start in what scrolls them, below the header: measured after each draw, as the
  // header changes its height, e.g. its buttons wrapping in lines.
  const [margin, setMargin] = useState(0);
  const guess = useRef(FIRST_GUESS);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => (list.current ? scroller(list.current) : null),
    // Until measured, as high as the window: so that the first draw shows rows, not none.
    initialRect: { width: 0, height: window.innerHeight },
    estimateSize: () => guess.current,
    overscan: 12,
    scrollMargin: margin,
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
    if (Math.abs(top - margin) > 0.01) setMargin(top);
  });

  // The row first in view, by its key, and how far it is scrolled past: found again after a draw
  // in which rows came or went before it, it is put back where it was.
  const anchor = useRef<{ key: string; past: number } | null>(null);
  const keep = () => {
    const offset = virtualizer.scrollElement?.scrollTop ?? 0; // the virtualizer's, a frame late
    const item = virtualizer.getVirtualItemForOffset(offset);
    anchor.current =
      offset > margin && item ? { key: String(item.key), past: offset - item.start } : null;
  };
  useLayoutEffect(() => {
    const [was, box] = [anchor.current, virtualizer.scrollElement];
    if (was !== null && box !== null) {
      const index = virtualizer.measurementsCache.findIndex((item) => item.key === was.key);
      const item = virtualizer.measurementsCache[index];
      const to = item && item.start + was.past;
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

  return (
    <ol
      ref={containerRef}
      className={`${styles.rows} ${styles.virtual}`}
      onPointerOver={onPointerOver}
    >
      {items.map((item) =>
        draw(item.index, { index: item.index, measure: virtualizer.measureElement }),
      )}
    </ol>
  );
}
