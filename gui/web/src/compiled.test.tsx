import { expect, it } from "vitest";
import { PanelView } from "./layout/PanelView";
import { ChangesView } from "./views/changes/ChangesView";
import { DiffView } from "./views/diff/DiffView";
import { FileBody, FileSection } from "./views/diff/FileSection";

// React's compiler memoizes components (vite.config.ts), failing the build where it can't: were
// it switched off, nothing would fail, it would only get slow. Its cache in their code, `c(n)`,
// says they are compiled.
it("has React's compiler memoize the components", () => {
  for (const component of [PanelView, ChangesView, DiffView, FileSection, FileBody]) {
    expect(component.toString(), component.name).toMatch(/\.c\)\(\d+\)/);
  }
});
