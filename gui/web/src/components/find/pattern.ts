// What a find looks for, as a regular expression, and where in lines it is found. Plain enough to
// run in a worker (`matcher.ts`).

/** What is looked for: text, or a regular expression; in this case only, or as a whole word. */
export interface FindQuery {
  text: string;
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
}

/** Where a match is: its line, and its start and end in it (UTF-16 offsets, as JS strings). */
export interface Match {
  line: number;
  start: number;
  end: number;
}

/** A regular expression as a worker can be given it. */
export interface Pattern {
  source: string;
  flags: string;
}

// What words are made of, in any script, for `\w`, `\b` and whole words alike: letters, their
// marks, digits, and connectors such as `_` (JS's own `\w` knows only ASCII).
const WORD = "\\p{L}\\p{M}\\p{N}\\p{Pc}";
const AFTER_WORD = `(?<=[${WORD}])`;
const NOT_AFTER_WORD = `(?<![${WORD}])`;
const BEFORE_WORD = `(?=[${WORD}])`;
const NOT_BEFORE_WORD = `(?![${WORD}])`;
const BOUNDARY = `(?:${AFTER_WORD}${NOT_BEFORE_WORD}|${NOT_AFTER_WORD}${BEFORE_WORD})`;
const NOT_BOUNDARY = `(?:${AFTER_WORD}${BEFORE_WORD}|${NOT_AFTER_WORD}${NOT_BEFORE_WORD})`;

// Outside a class: the shorthands for words, digits and their boundaries, in Unicode's terms.
const OUTSIDE: Record<string, string> = {
  w: `[${WORD}]`,
  W: `[^${WORD}]`,
  d: "\\p{Nd}",
  D: "\\P{Nd}",
  b: BOUNDARY,
  B: NOT_BOUNDARY,
};

// Inside one: `\W` can't join a class's other items, so `rewriteClass` takes it apart; `[\b]` is
// a backspace, as in JS.
const INSIDE: Record<string, string> = { w: WORD, d: "\\p{Nd}", D: "\\P{Nd}" };

/**
 * A regular expression's source with `\w`, `\W`, `\b`, `\B`, `\d` and `\D` meaning Unicode's
 * words and digits, also inside classes; everything else as written.
 */
export function unicodeSource(source: string): string {
  let out = "";
  for (let at = 0; at < source.length; at++) {
    const char = source[at] as string;
    if (char === "\\") {
      const next = source[at + 1] ?? "";
      out += OUTSIDE[next] ?? `\\${next}`;
      at++;
    } else if (char === "[") {
      const end = classEnd(source, at);
      out += rewriteClass(source.slice(at + 1, end));
      at = end;
    } else out += char;
  }
  return out;
}

/** Where the class starting at `start` ends: its closing `]`, or the source's end. */
function classEnd(source: string, start: number): number {
  let at = start + 1;
  if (source[at] === "^") at++;
  for (; at < source.length; at++) {
    if (source[at] === "\\") at++;
    else if (source[at] === "]") return at;
  }
  return source.length;
}

/** A class, given what is between its brackets, with the shorthands rewritten. */
function rewriteClass(body: string): string {
  const negated = body.startsWith("^");
  let items = "";
  let notWord = false; // a `\W` in it, which no class item can stand for
  for (let at = negated ? 1 : 0; at < body.length; at++) {
    const char = body[at] as string;
    if (char !== "\\") {
      items += char;
      continue;
    }
    const next = body[at + 1] ?? "";
    at++;
    if (next === "W") notWord = true;
    else items += INSIDE[next] ?? `\\${next}`;
  }
  if (!notWord) return `[${negated ? "^" : ""}${items}]`;
  // Any of the items or a character not of words; or, negated, a word's not among the items.
  if (negated) return items === "" ? `[${WORD}]` : `(?:(?![${items}])[${WORD}])`;
  return items === "" ? `[^${WORD}]` : `(?:[${items}]|[^${WORD}])`;
}

const PREFIX = /^Invalid regular expression: \/.*\/[a-z]*: /s;

/** The characters a regular expression gives a meaning, escaped: what is typed, found as it is. */
function escaped(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
}

/** The pattern a query looks for, or why it can't: an invalid regular expression. */
export function findPattern(query: FindQuery): Pattern | { error: string } {
  const body = query.regex ? unicodeSource(query.text) : escaped(query.text);
  const source = query.wholeWord ? `${NOT_AFTER_WORD}(?:${body})${NOT_BEFORE_WORD}` : body;
  const flags = query.matchCase ? "gu" : "giu";
  try {
    new RegExp(source, flags);
  } catch (error) {
    // Why, without the expression as rewritten above, which Chromium's message repeats.
    const why = String(error instanceof SyntaxError ? error.message : error);
    return { error: `Invalid regular expression: ${why.replace(PREFIX, "")}` };
  }
  return { source, flags };
}

/**
 * The pattern's matches in the lines, in their order, at most `limit` (and whether there are more);
 * none of nothing, e.g. of `a*` between the `b`s of `bb`.
 */
export function findMatches(
  lines: readonly string[],
  { source, flags }: Pattern,
  limit: number,
): { matches: Match[]; more: boolean } {
  const pattern = new RegExp(source, flags);
  const matches: Match[] = [];
  for (let line = 0; line < lines.length; line++) {
    const text = lines[line] as string;
    pattern.lastIndex = 0;
    for (let found = pattern.exec(text); found !== null; found = pattern.exec(text)) {
      const end = found.index + found[0].length;
      if (end === found.index) {
        // Nothing matched here: on to the next character, a whole one.
        pattern.lastIndex = end + ((text.codePointAt(end) ?? 0) > 0xffff ? 2 : 1);
        continue;
      }
      if (matches.length === limit) return { matches, more: true };
      matches.push({ line, start: found.index, end });
    }
  }
  return { matches, more: false };
}
