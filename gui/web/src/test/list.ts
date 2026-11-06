/** A list item's own row, without the rows a tree draws within it. */
export function ownRow(item: HTMLElement): HTMLElement {
  return item.matches("li") ? (item.querySelector<HTMLElement>(":scope > div") ?? item) : item;
}

/** A list row's cells as text, without its square. */
export function cells(row: HTMLElement): string[] {
  return [...ownRow(row).querySelectorAll(":scope > [data-column]")]
    .slice(1)
    .map((cell) => cell.textContent ?? "");
}
