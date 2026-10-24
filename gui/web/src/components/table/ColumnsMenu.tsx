import { useAtom } from "@tanstack/react-store";
import type { Column, ReactTable, RowData } from "@tanstack/react-table";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import type { RefObject } from "react";
import { Menu, MenuItem, MenuSection, Popover, Separator } from "react-aria-components";
import popover from "../popover.module.css";
import styles from "./ColumnsMenu.module.css";
import { arrangedOrder, movedPast } from "./columns";
import { columnOrder, hiddenColumns, resetLook } from "./kept";
import type { ListFeatures } from "./list";

interface Props<TData extends RowData> {
  table: ReactTable<ListFeatures, TData>;
  clicked: string | undefined; // the column whose header was clicked, if one to arrange
  anchor: RefObject<HTMLElement | null>; // where it was clicked
  keyboard: boolean; // whether opened by it: then its first item is focused
  onClose: () => void;
}

/**
 * A list's columns, as kept for its kind of View: those shown ticked, those that must show
 * greyed out, saying why; the one clicked moved left or right; and all as at first again, its
 * layout too.
 */
export function ColumnsMenu<TData extends RowData>({
  table,
  clicked,
  anchor,
  keyboard,
  onClose,
}: Props<TData>) {
  const kind = table.options.meta?.kind ?? "";
  const [hidden, setHidden] = useAtom(hiddenColumns(kind));
  const [moved, setMoved] = useAtom(columnOrder(kind));
  const columns = arrangedOrder(table.options.columns, moved).flatMap((id) => {
    const column = table.getColumn(id);
    return column ? [column] : [];
  });
  const order = columns.map((column) => column.id);
  const shown = new Set(columns.filter((column) => column.getIsVisible()).map(({ id }) => id));
  const reasons = new Map(
    columns.flatMap((column) => {
      const reason = mustShow(column, shown);
      return reason === undefined ? [] : [[column.id, reason]];
    }),
  );
  const choose = (chosen: "all" | Set<unknown>) => {
    if (chosen === "all") return;
    const listed = new Set(order);
    setHidden([
      ...hidden.filter((id) => !listed.has(id) || reasons.has(id)), // as they were
      ...order.filter((id) => !reasons.has(id) && !chosen.has(id)),
    ]);
  };
  const name = clicked && table.getColumn(clicked)?.columnDef.header;
  const moves = ([-1, 1] as const).map((step) => ({
    step,
    order: clicked === undefined ? undefined : movedPast(order, clicked, step, shown),
    Icon: step < 0 ? ArrowLeft : ArrowRight,
    label: `Move "${name}" ${step < 0 ? "left" : "right"}`,
  }));
  return (
    <Popover
      className={popover.popover}
      triggerRef={anchor}
      isOpen
      onOpenChange={(open) => open || onClose()}
      placement="bottom start"
    >
      <Menu
        className={popover.menu}
        aria-label="Columns"
        autoFocus={keyboard ? "first" : true}
        onClose={onClose}
        onContextMenu={(event) => {
          event.preventDefault(); // nor is it for the header below
          event.stopPropagation();
        }}
      >
        <MenuSection
          aria-label="Columns shown"
          selectionMode="multiple"
          selectedKeys={shown}
          onSelectionChange={choose}
          shouldCloseOnSelect={false}
        >
          {columns.map((column) => (
            <MenuItem
              key={column.id}
              id={column.id}
              className={styles.item}
              isDisabled={reasons.has(column.id)}
              textValue={column.columnDef.header as string}
            >
              {/* Its own tooltip: React Aria's items take none. */}
              <span className={styles.label} title={reasons.get(column.id)}>
                <Check className={styles.tick} aria-hidden="true" />
                {column.columnDef.header as string}
              </span>
            </MenuItem>
          ))}
        </MenuSection>
        <Separator className={popover.separator} />
        {typeof name === "string" && (
          <MenuSection className={styles.moves} aria-label={`Move "${name}"`}>
            {moves.map(({ step, order, Icon, label }) => (
              <MenuItem
                key={step}
                id={step}
                className={styles.item}
                aria-label={label}
                isDisabled={order === undefined}
                shouldCloseOnSelect={false}
                onAction={() => order && setMoved(order)}
              >
                <span className={styles.label} title={label}>
                  <Icon aria-hidden="true" />
                </span>
              </MenuItem>
            ))}
          </MenuSection>
        )}
        <MenuItem className={styles.item} onAction={() => resetLook(kind)}>
          <span className={styles.label}>Reset columns</span>
        </MenuItem>
      </Menu>
    </Popover>
  );
}

/** Why a column can't be hidden now, if so. */
function mustShow<TData extends RowData>(
  column: Column<ListFeatures, TData>,
  shown: Set<string>,
): string | undefined {
  if (column.columnDef.meta?.identifies) return "Always shown: it says what a row is";
  if (column.getIsFiltered()) return "Shown while filtered by it: clear its filter first";
  if (column.getIsSorted()) return "Shown while sorted by it: sort by another column first";
  if (shown.size === 1 && shown.has(column.id)) return "The only column shown";
  return undefined;
}
