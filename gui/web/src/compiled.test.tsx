import { expect, it } from "vitest";
import Diff from "./components/diff/Diff";
import { PanelView } from "./layout/PanelView";
import { ViewOpener } from "./layout/ViewOpener";
import { useDebounced } from "./useDebounced";
import { ChangesView } from "./views/changes/ChangesView";
import { useFolds } from "./views/changes/folds";
import { useChangesTable } from "./views/changes/table";
import { DbView } from "./views/db/DbView";
import { DiffView } from "./views/diff/DiffView";
import { FileBody, FileSection } from "./views/diff/FileSection";
import { EventsView } from "./views/events/EventsView";
import { HistoryView } from "./views/history/HistoryView";
import { LogView } from "./views/log/LogView";
import { useIsShown } from "./views/opening";
import { RepositoriesView } from "./views/repositories/RepositoriesView";

// React's compiler memoizes components and hooks (vite.config.ts), failing the build where it
// can't: were it switched off, nothing would fail, it would only get slow, and redraw what must
// stay, e.g. a diff whose versions came again unchanged. Its cache in their code, `c(n)`, says
// they are compiled: components, and hooks in plain modules too.
it("has React's compiler memoize the components and hooks", () => {
  const compiled = [
    ...[PanelView, ViewOpener, ChangesView, DbView, DiffView, FileSection, FileBody, Diff],
    ...[EventsView, HistoryView, LogView, RepositoriesView],
    ...[useDebounced, useFolds, useChangesTable, useIsShown],
  ];
  for (const code of compiled) {
    expect(code.toString(), code.name).toMatch(/\.c\)\(\d+\)/);
  }
});
