// The look in one place: theme.css names colours, sizes and states; every other stylesheet uses
// those names, or the shared looks of components/controls.module.css and text.module.css. These
// rules fail where a stylesheet sets its own instead (ADR 005, Look).

import { readFileSync } from "node:fs";
import postcss, { type Declaration } from "postcss";
import { describe, expect, it } from "vitest";

// Their paths only: read as they are, as Vitest hands stylesheets on processed.
const sheets = Object.keys(import.meta.glob(["./**/*.css", "!./theme.css"]));

const COLOUR = new RegExp(
  [
    String.raw`#[0-9a-f]{3,8}\b`,
    String.raw`\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(`,
    String.raw`\b(white|black|red|green|blue|yellow|orange|purple|pink|gr[ae]y|silver|brown)\b`,
  ].join("|"),
  "i",
);
// Lengths of their own; `ch`, `lh`, percentages and the viewport's units go by what they hold.
const LENGTH = /(?<![\w-])-?(\d*\.)?\d+(px|rem|em|pt|pc|cm|mm|in|ex|cap)\b/g;
const HAIRLINE = /^(border|outline|box-shadow)/; // whose 1px is a hairline, written so
const STATE = new RegExp(
  [
    String.raw`:(hover|focus|focus-visible|focus-within|active)\b`,
    String.raw`\[data-(hovered|focused|focus-visible|focus-within|pressed|current|showing|selected|taken)\]`,
    String.raw`\[aria-(pressed|selected|current)`,
  ].join("|"),
);

/** What a declaration breaks of the rules, if anything. */
function broken(decl: Declaration): string | undefined {
  const { prop, value } = decl;
  const named = value.replace(/var\(--[\w-]+/g, "var(");
  if (COLOUR.test(named)) return "a colour of its own: name it in theme.css";
  if (prop.startsWith("--")) return undefined; // naming a value is what the rules ask for
  for (const [length] of named.matchAll(LENGTH)) {
    if (/^-?0?\.?0+[a-z]+$/.test(length)) continue;
    if (HAIRLINE.test(prop) && /^-?1px$/.test(length)) continue;
    return `a size of its own (${length}): use theme.css's, or name it`;
  }
  if (prop === "opacity" && !/^(var\(--[\w-]+\)|0|1)$/.test(value)) {
    return "an opacity of its own: --dimmed, --faint";
  }
  if (prop === "font-weight" && !/^(var\(--weight-[\w-]+\)|normal|inherit)$/.test(value)) {
    return "a weight of its own: --weight-strong";
  }
  const rule = decl.parent;
  if (/^background(-color)?$/.test(prop) && rule?.type === "rule") {
    const selector = (rule as postcss.Rule).selector;
    const colours = [...value.matchAll(/var\((--[\w-]+)/g)].map(([, name]) => name ?? "");
    const off = colours.find((name) => !/^--(fill|space|icon)-/.test(name));
    if (STATE.test(selector) && off !== undefined) {
      return `a state's fill of its own (${off}): use a --fill- token`;
    }
  }
  return undefined;
}

describe("stylesheets", () => {
  it("use theme.css's colours, sizes, opacities, weights and state fills", () => {
    expect(sheets.length).toBeGreaterThan(20); // found them all, not none
    const found: string[] = [];
    for (const path of sheets) {
      const text = readFileSync(new URL(path, import.meta.url), "utf8");
      postcss.parse(text).walkDecls((decl) => {
        const why = broken(decl);
        if (why) found.push(`${path}:${decl.source?.start?.line}: ${decl.prop}: ${why}`);
      });
    }
    expect(found).toEqual([]);
  });

  // What a class composes may come later in the page, the build keeping no order: a class sets
  // none of its properties again; the shared looks take variants by custom properties instead.
  it("override nothing they compose", () => {
    const found: string[] = [];
    for (const path of sheets) {
      const url = new URL(path, import.meta.url);
      postcss.parse(readFileSync(url, "utf8")).walkDecls("composes", (decl) => {
        const [, names, from] = decl.value.match(/^(.+) from "(.+)"$/) ?? [];
        if (!names || !from) return;
        const own = new Set(decl.parent?.nodes.flatMap((n) => (n.type === "decl" ? [n.prop] : [])));
        const other = postcss.parse(readFileSync(new URL(from, url), "utf8"));
        for (const name of names.split(/\s+/)) {
          other.walkRules(`.${name}`, (rule) => {
            rule.walkDecls((composed) => {
              if (composed.prop !== "composes" && own.has(composed.prop)) {
                found.push(`${path}: ${composed.prop} of ${name}`);
              }
            });
          });
        }
      });
    }
    expect(found).toEqual([]);
  });

  it("find what breaks the rules", () => {
    const decls = (css: string) => {
      const all: Declaration[] = [];
      postcss.parse(css).walkDecls((decl) => {
        all.push(decl);
      });
      return all.map(broken);
    };
    expect(
      decls(`.a { color: #fff; padding: 3px; opacity: 0.5; font-weight: 600 }
        .a:hover { background: var(--accent) }`),
    ).toEqual([
      expect.stringContaining("colour"),
      expect.stringContaining("size"),
      expect.stringContaining("opacity"),
      expect.stringContaining("weight"),
      expect.stringContaining("fill"),
    ]);
    expect(
      decls(`.a { --x: 3rem; padding: 0 var(--space-1); border: 1px solid var(--border);
        width: 12ch; height: 100%; opacity: var(--dimmed) }
        .a:hover { background: var(--fill-hover) } .b { background: var(--bar) }`),
    ).toEqual(Array(8).fill(undefined));
  });
});
