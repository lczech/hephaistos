import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const GUI = join(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Biome's findings on a file at `path`, with the GUI's configuration and its plugins, as `npm run
 * lint`: its rules and overrides too, by the path, where `whole`.
 */
function lint(source: string, path = "probe.ts", whole = false): string {
  const config = JSON.parse(readFileSync(join(GUI, "biome.json"), "utf8"));
  const dir = mkdtempSync(join(tmpdir(), "lint-"));
  try {
    const plugins = config.plugins.map((plugin: string) => join(GUI, plugin));
    const used = whole ? { ...config, $schema: undefined, vcs: undefined, plugins } : { plugins };
    writeFileSync(join(dir, "biome.json"), JSON.stringify(used));
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), source);
    const found = spawnSync(join(GUI, "node_modules/.bin/biome"), ["lint", path], {
      cwd: dir,
      encoding: "utf8",
    });
    return found.stdout + found.stderr; // its findings, on stderr
  } finally {
    rmSync(dir, { recursive: true });
  }
}

// Views are drawn over their Groups, not in them: what holds an element says nothing of its
// Panel or Group, so nothing reads dockview's elements (`lint/dock-elements.grit`).
it("has lint reject reading dockview's elements, but where said why", () => {
  const read = "export const f = (group: { element: HTMLElement }) => group.element;\n";
  expect(lint(read)).toContain("Do not read dockview's elements");
  const excused = `export const f = (group: { element: HTMLElement }) =>
  // biome-ignore lint/plugin: why
  group.element;
`;
  expect(lint(excused)).not.toContain("Do not read dockview's elements");
});

// React's compiler memoizes (`lint/no-manual-memo.grit`).
it("has lint reject memoizing by hand", () => {
  const memoized = `import { memo, useCallback, useMemo } from "react";
export function useTwice(n: number) {
  const twice = useMemo(() => 2 * n, [n]);
  return [twice, useCallback(() => n, [n])];
}
export const Shown = memo(() => null);
`;
  expect(lint(memoized).match(/Do not memoize by hand/g)).toHaveLength(3);
});

// The look lives in the stylesheets (`lint/inline-styles.grit`).
it("has lint reject inline styles but custom properties, outside tests", () => {
  const styled = `export const A = () => <div style={{ color: "red" }} />;
export const B = () => <div style={cssVars({ "--x": 1 })} />;
declare function cssVars(vars: object): object;
`;
  expect(lint(styled, "probe.tsx").match(/Do not style inline/g)).toHaveLength(1);
  expect(lint(styled, "probe.test.tsx")).not.toContain("Do not style inline");
});

// Each override of `noRestrictedImports` in biome.json sets its options anew, so restates each
// restriction: the cases below take each folder of an override, so that a copy missed fails.
const OVERRIDDEN = ["layout", "views/changes", "views/diff", "views/comparison", "components/diff"];

// Only layout/ uses dockview (ADR 005).
it("has lint keep dockview in layout/", () => {
  const docked = `import { DockviewReact } from "dockview-react";\nexport { DockviewReact };\n`;
  const own = "Only layout/ uses dockview";
  for (const elsewhere of ["views/events", ...OVERRIDDEN.filter((at) => at !== "layout")]) {
    expect(lint(docked, `web/src/${elsewhere}/probe.ts`, true), elsewhere).toContain(own);
  }
  expect(lint(docked, "web/src/layout/probe.ts", true)).not.toContain(own);
});

// The Changes and Diff Views share what both need through views/comparison/, never importing
// each other, nor it them.
it("has lint keep the Changes and Diff Views apart", () => {
  const apart = "never importing each other";
  const from = (folder: string) => `import { x } from "../${folder}/x";\nexport { x };\n`;
  const deep = (folder: string) => `import { x } from "../../views/${folder}/x";\nexport { x };\n`;
  for (const [at, other] of [
    ["diff", "changes"],
    ["changes", "diff"],
    ["comparison", "changes"],
    ["comparison", "diff"],
  ] as const) {
    for (const source of [from(other), deep(other)]) {
      expect(lint(source, `web/src/views/${at}/probe.ts`, true), `${at}: ${source}`).toContain(
        apart,
      );
    }
  }
  expect(lint(from("changes"), "web/src/views/events/probe.ts", true)).not.toContain(apart);
});

// `@pierre/diffs` is pinned and checked on each upgrade (development.md): only components/diff/
// uses it.
it("has lint keep @pierre/diffs in components/diff/", () => {
  const drawn = `import { FileDiff } from "@pierre/diffs/react";
import { parsePatchFiles } from "@pierre/diffs";
export { FileDiff, parsePatchFiles };
`;
  const own = "Only components/diff/ uses @pierre/diffs";
  const elsewhere = ["views/events", "components/list", ...OVERRIDDEN];
  for (const at of elsewhere.filter((at) => at !== "components/diff")) {
    expect(
      lint(drawn, `web/src/${at}/probe.ts`, true).match(new RegExp(own, "g")),
      at,
    ).toHaveLength(2);
  }
  expect(lint(drawn, "web/src/components/diff/probe.ts", true)).not.toContain(own);
});
