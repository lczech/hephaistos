import { screen, waitFor } from "@testing-library/react";

/** A list's row: its own cells, without its details below them. */
export function ownRow(item: HTMLElement): HTMLElement {
  return item.matches("[role=row]")
    ? (item.querySelector<HTMLElement>(":scope > div") ?? item)
    : item;
}

/** A list row's cells as text, without its square. */
export function cells(row: HTMLElement): string[] {
  return [...ownRow(row).querySelectorAll(":scope > [data-column]")]
    .slice(1)
    .map((cell) => cell.textContent ?? "");
}

/**
 * A list row's cells as a browser draws them, line by line: the columns of those shown, left to
 * right; a cell starts a line below the one before once it lies below that line's cells.
 */
export function linesOf(row: HTMLElement): string[][] {
  const shown = [...ownRow(row).querySelectorAll<HTMLElement>(":scope > [data-column]")]
    .map((cell) => ({ column: cell.dataset.column ?? "", box: cell.getBoundingClientRect() }))
    .filter(({ box }) => box.width > 0 && box.height > 0)
    .sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left);
  const lines: { bottom: number; cells: typeof shown }[] = [];
  for (const cell of shown) {
    const line = lines.at(-1);
    if (line && cell.box.top < line.bottom - 1) {
      line.cells.push(cell);
      line.bottom = Math.max(line.bottom, cell.box.bottom);
    } else lines.push({ bottom: cell.box.bottom, cells: [cell] });
  }
  return lines.map((line) =>
    line.cells.sort((a, b) => a.box.left - b.box.left).map((cell) => cell.column),
  );
}

/** Of a list's rows as screen readers find them, those of what it lists: not its header's. */
const listed = (rows: HTMLElement[]) =>
  rows.filter((row) => row.getAttribute("aria-rowindex") !== "1");

/** The rows of the lists shown, drawn: their rows stuck aside, hidden from screen readers. */
export const listRows = () => listed(screen.getAllByRole("row"));

/** The same, none if there are none. */
export const queryListRows = () => listed(screen.queryAllByRole("row"));

/** The same, once there are some. */
export const findListRows = () =>
  waitFor(() => {
    const rows = listRows();
    if (rows.length === 0) throw new Error("no rows listed yet");
    return rows;
  });
