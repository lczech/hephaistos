import { useAtom } from "@tanstack/react-store";
import type { ReactTable, RowData } from "@tanstack/react-table";
import { type RefObject, useState } from "react";
import { type DropItem, isTextDropItem, useDrop } from "react-aria-components";
import { COLUMN_DRAG } from "./ColumnHeader";
import { arrangeable, arrangedOrder, movedBeside } from "./columns";
import { columnOrder, fingerPointer, type ListLayout } from "./kept";
import type { ListFeatures } from "./list";

/** Where a header dragged would go: after this many of the headers shown, at `x` in the row. */
interface Gap {
  at: number;
  x: number;
}

/**
 * Columns moved by dragging their headers onto the header row: where one would go, between the
 * headers shown, as a line at `line`; dropped, it moves there, among those hidden as well. Only
 * in columns, only with a mouse: a finger's long press opens the header's menu instead. A header
 * says what it carries, if it may be dragged (`carried`).
 */
export function useColumnDrop<TData extends RowData>(
  table: ReactTable<ListFeatures, TData>,
  head: RefObject<HTMLDivElement | null>,
  layout: ListLayout,
) {
  const kind = table.options.meta?.kind ?? "";
  const [moved, setMoved] = useAtom(columnOrder(kind));
  const [line, setLine] = useState<number | null>(null);
  const shown = () => table.getVisibleLeafColumns().filter((c) => arrangeable(c.columnDef));
  // The gap nearest to `x`, between the headers shown, by their middles.
  const gapAt = (x: number): Gap | undefined => {
    const element = head.current;
    if (element === null) return undefined;
    const row = element.getBoundingClientRect();
    const gap = Number.parseFloat(getComputedStyle(element).columnGap) || 0;
    const boxes = shown().flatMap(({ id }) => {
      const cell = [...element.children].find(
        (each) => each instanceof HTMLElement && each.dataset.column === id,
      );
      return cell ? [cell.getBoundingClientRect()] : [];
    });
    const last = boxes.at(-1);
    if (last === undefined) return undefined;
    const at = boxes.filter((box) => box.left + box.width / 2 - row.left < x).length;
    const next = boxes[at];
    return { at, x: (next ? next.left - gap / 2 : last.right + gap / 2) - row.left };
  };
  const drop = async (items: DropItem[], x: number) => {
    const item = items.find((each) => isTextDropItem(each) && each.types.has(COLUMN_DRAG));
    const gap = gapAt(x);
    if (item === undefined || !isTextDropItem(item) || gap === undefined) return;
    const carried = JSON.parse(await item.getText(COLUMN_DRAG)) as { kind: string; id: string };
    const ids = shown().map(({ id }) => id);
    const other = ids[Math.min(gap.at, ids.length - 1)];
    if (carried.kind !== kind || other === undefined || other === carried.id) return;
    const order = arrangedOrder(table.options.columns, moved);
    if (order.includes(carried.id)) {
      setMoved(movedBeside(order, carried.id, other, gap.at >= ids.length));
    }
  };
  const { dropProps } = useDrop({
    ref: head,
    isDisabled: layout !== "columns",
    getDropOperation: (types) => (types.has(COLUMN_DRAG) ? "move" : "cancel"),
    onDropMove: ({ x }) => setLine(gapAt(x)?.x ?? null),
    onDropExit: () => setLine(null),
    onDrop: ({ items, x }) => {
      setLine(null);
      void drop(items, x);
    },
  });
  const draggable = layout === "columns" && !fingerPointer();
  const carried = (id: string) => (draggable ? JSON.stringify({ kind, id }) : undefined);
  return { dropProps, line, carried };
}
