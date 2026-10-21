import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const GUI = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** Biome's findings on a file, with the GUI's configuration and its plugins, as `npm run lint`. */
function lint(source: string): string {
  const config = JSON.parse(readFileSync(join(GUI, "biome.json"), "utf8"));
  const dir = mkdtempSync(join(tmpdir(), "lint-"));
  try {
    const plugins = config.plugins.map((plugin: string) => join(GUI, plugin));
    writeFileSync(join(dir, "biome.json"), JSON.stringify({ plugins }));
    writeFileSync(join(dir, "probe.ts"), source);
    const found = spawnSync(join(GUI, "node_modules/.bin/biome"), ["lint", "probe.ts"], {
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
  expect(lint(read)).toContain("Don't read dockview's elements");
  const excused = `export const f = (group: { element: HTMLElement }) =>
  // biome-ignore lint/plugin: why
  group.element;
`;
  expect(lint(excused)).not.toContain("Don't read dockview's elements");
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
  expect(lint(memoized).match(/Don't memoize by hand/g)).toHaveLength(3);
});
