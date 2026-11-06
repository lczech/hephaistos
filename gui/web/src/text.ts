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

/**
 * A size in bytes, as its amount and unit: `512`, `B`; `3.4`, `kB`; `12`, `kB`; `1.2`, `MB`. In
 * the unit its rounded amount stays below 1000 in: 999,600 bytes are `1.0` `MB`, not `1000` `kB`.
 */
export function sizeParts(bytes: number): [string, string] {
  if (bytes < 1000) return [`${bytes}`, "B"];
  const units: [number, string][] = [
    [1e3, "kB"],
    [1e6, "MB"],
  ];
  for (const [size, unit] of units) {
    if (Math.round(bytes / size) < 1000) return [amount(bytes / size), unit];
  }
  return [amount(bytes / 1e9), "GB"];
}

/** One decimal below 10 (as rounded: 9.96 is `10`), else whole: `3.4`, `12`. */
function amount(value: number): string {
  const tenth = value.toFixed(1);
  return Number(tenth) < 10 ? tenth : `${Math.round(value)}`;
}

/** A size in bytes, as `512 B`, `3.4 kB`, `12 kB`, `1.2 MB`: as the CLI's `size_text`. */
export function sizeText(bytes: number): string {
  return sizeParts(bytes).join(" ");
}
