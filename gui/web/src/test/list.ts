/** A list row's cells as text, without its square. */
export function cells(row: HTMLElement): string[] {
  return [...row.querySelectorAll("[data-column]")].slice(1).map((cell) => cell.textContent ?? "");
}
