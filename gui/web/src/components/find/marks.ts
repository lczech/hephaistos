// Matches found, marked in text by the CSS Custom Highlight API: without changing the elements
// that draw it, so also within others' elements, e.g. a renderer's shadow DOM. None where a
// browser lacks it.

const FOUND = "hephaistos-found";
const CURRENT = "hephaistos-found-current";

/** The marks' look (`theme.css`), for the CSS of where they are: a shadow root's text takes
 * only its own rules. */
export const MARKS_LOOK = `::highlight(${FOUND}) {
  background-color: var(--found);
  color: var(--found-text);
}
::highlight(${CURRENT}) {
  background-color: var(--found-current);
  color: var(--found-text);
}`;

function highlight(name: string): Highlight | undefined {
  if (typeof Highlight === "undefined") return undefined;
  let found = CSS.highlights.get(name);
  if (found === undefined) {
    found = new Highlight();
    CSS.highlights.set(name, found);
  }
  return found;
}

/** The range of an element's text from `start` to `end`, across the elements within it. */
export function rangeIn(element: HTMLElement, start: number, end: number): Range | undefined {
  const range = new Range();
  const texts = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let at = 0;
  for (let node = texts.nextNode(); node !== null; node = texts.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (start >= at && start <= at + length) range.setStart(node, start - at);
    if (end >= at && end <= at + length) {
      range.setEnd(node, end - at);
      return range;
    }
    at += length;
  }
  return undefined;
}

/** A match's text to mark; the current one stands out. */
export interface Marked {
  range: Range;
  current: boolean;
}

/** Marks these matches; gives what takes them out again. */
export function markMatches(found: readonly Marked[]): () => void {
  for (const { range, current } of found) highlight(current ? CURRENT : FOUND)?.add(range);
  return () => {
    for (const { range, current } of found) highlight(current ? CURRENT : FOUND)?.delete(range);
  };
}
