// Words and numbers in what users read: capitals, counts, lists and IDs.

/** The text with a capital first letter: `uncommitted changes` → `Uncommitted changes`. */
export function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A number as the GUI writes it, its thousands apart: `1,234`. */
export function numberText(n: number): string {
  return n.toLocaleString("en");
}

/** A number, with a + where there are more than it counts, as of a list cut short: `12+`. */
export function atLeast(n: number, more: boolean): string {
  return `${numberText(n)}${more ? "+" : ""}`;
}

/** The noun for a number of things, singular for one alone: `file`, `files`. */
export function plural(n: number, noun: string, more = false): string {
  return n === 1 && !more ? noun : `${noun}s`;
}

/** A number of things: `1 file`, `1,234 files`; `12+ files` where there are more. */
export function counted(n: number, noun: string, more = false): string {
  return `${atLeast(n, more)} ${plural(n, noun, more)}`;
}

/** Words in a sentence: `a`, `a and b`, `a, b and c`. */
export function listText(words: string[]): string {
  return words.length > 1
    ? `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`
    : (words[0] ?? "");
}

/** The end of an ID, as the CLI shows it in lists: `deadbeef`. */
export function shortId(id: string): string {
  return id.replaceAll("-", "").slice(-8);
}

/** Something by its name, else its short ID: a Machine, a Repository. */
export function nameOrId({ name, id }: { name: string | null; id: string }): string {
  return name ?? shortId(id);
}
