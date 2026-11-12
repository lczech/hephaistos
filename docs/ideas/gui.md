# Ideas: the GUI

Ideas for the GUI as a whole; those for single Views are in [Views](views.md).

## Words and clicks

- GUI vocabulary (user, 2026-10-17): make consistent and visible what a click does (a row opens a View, a Diff, a commit or its details, by View), which icons are clickable, and links against buttons (`ViewLink`, bordered buttons, underlined text).
- Agreed: a commit hash shown on its own links to the Changes of its commit, also inside summaries, which then need to be structured.
- The warning about other directories in the Status View says "this shell" (`daemon/report.py`), which reads oddly in the GUI.

## Keys and lists

- Typing jumps to the next row starting so (typeahead).
- Later: the page's own find (Ctrl+F, in a browser) finds only the rows drawn; a find of their own for the lists without one (Events, Repositories, History, the database).
- In TanStack Table, for when needed (2026-10-24): a quick text filter over the loaded rows of a list (global filtering), counts per value in header filters (faceting), rows grouped by a column (grouping), several rows selected for one action (row selection).
- Density for all lists: how close their rows stand, as a setting.

## Panels and the Layout

- The "+" menu (2026-11-07): long term, "+" is for Views made on the spot (Terminals, files, Agents), and Repositories and Events leave it too.
- Shown Views: maybe mark the `ViewLink` icon of a shown View, rather than rows of Repositories.
- Back and Forward that keep the scroll position (agreed 2026-11-01, not needed now): keep a few earlier Views of a Panel mounted but hidden with React `<Activity>`, rather than restoring `scrollTop` by hand, which lazy loading and virtualised Diffs defeat; Diffs are heavy.
  First test whether the scroll position survives `display: none` in Chromium and WebKit.
- Memory with many Panels (user): if needed, send the Panels used least recently back to `onlyWhenVisible`, saving and restoring their scroll position.
- A dashboard or control center: status icons with counts, summaries per Repository, entry points into other Views.
- GUI View types as plugins, in TypeScript (from the ADRs).
- Dragging rows into Groups: a file of the Explorer, a row of Repositories, to open its View there.

## Looks

- `layout-arrow-right` and `layout-arrow-down` as icons for splitting or "open beside" (user, 2026-10-19); `columns-2` and the like now show the buttons for columns of Groups.
- Colours as settings: one `[gui.colors]` table that overrides tokens of `theme.css` by name, if wanted.
- Scrollbars of our own (user, 2026-10-23: "useful for later"): a drawn track with markers, as in VS Code and JetBrains, for the matches of Find and the current one, maybe for changes.

## Live updates

On a hint, fetch only newer Events and log records (`after=`) rather than every page again; with several Machines, staleness per View or per row.

## Forge links

A setting for self-hosted forges (e.g. `web.hosts`), and maybe Clones that link their own `origin`.

## Phone

A service worker (e.g. `vite-plugin-pwa`) that keeps the files of the page, and the TanStack cache persisted, to show last-known data with its time.
A rebuilt GUI must replace the cached one.

## Upstream

Reports the user may file, in public:

- dockview: with `always`, a tab shows one frame late (one empty frame per switch, 8.6.1).
- dockview: double-clicking a divider to even out Groups, or an event for dividers and a public "distribute"; meanwhile `layout/dividers.ts` reads `dv-sash` and its nesting (since 2026-11-07).
- Pierre: split or unified chosen by width.
- Pierre (1.5.2): `Virtualizer.scrollTo` clamps by heights measured before a diff draws; `getOffsetInScrollContainer` is off in WebKit after scrolling.
- Pierre (1.5.2): `isLineRenderable` is true for all lines before a render or as a placeholder, and there is no callback on expanding.
