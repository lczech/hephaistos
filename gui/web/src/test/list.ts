import { screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

/** A list's row: its own cells, without its details below them. */
export function ownRow(item: HTMLElement): HTMLElement {
  return item.matches("[role=row]")
    ? (item.querySelector<HTMLElement>(":scope > div") ?? item)
    : item;
}

/** A row's cells: in it, or in two lines, in its lines. */
const CELLS = ":scope > [data-column], :scope > * > [data-column]";

/** A list row's cells as text, without its square. */
export function cells(row: HTMLElement): string[] {
  return [...ownRow(row).querySelectorAll(CELLS)].slice(1).map((cell) => cell.textContent ?? "");
}

/**
 * A list row's cells as a browser draws them, line by line: the columns of those shown, left to
 * right; a cell starts a line below the one before once it lies below that line's cells.
 */
export function linesOf(row: HTMLElement): string[][] {
  const shown = [...ownRow(row).querySelectorAll<HTMLElement>(CELLS)]
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

/**
 * Stands in for IntersectionObserver in a list whose end comes into view by hand, and stays
 * there, as at the end of a short list: as in a browser, an observer set up meanwhile, e.g.
 * once a page loaded or a load was given up, says so at once. Returns what scrolls to the end.
 */
export function endOfList(): () => void {
  let atEnd = false;
  const observers = new Set<EndObserver>();
  class EndObserver {
    readonly targets = new Set<Element>();
    constructor(private readonly seen: IntersectionObserverCallback) {}
    observe(target: Element) {
      this.targets.add(target);
      observers.add(this);
      if (atEnd) this.report([target]);
    }
    unobserve(target: Element) {
      this.targets.delete(target);
    }
    disconnect() {
      this.targets.clear();
      observers.delete(this);
    }
    takeRecords() {
      return [];
    }
    report(targets: Iterable<Element>) {
      const entries = [...targets].map((target) => ({ isIntersecting: true, target }));
      this.seen(entries as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
    }
  }
  vi.stubGlobal("IntersectionObserver", EndObserver);
  return () => {
    atEnd = true;
    for (const observer of [...observers]) observer.report(observer.targets);
  };
}
