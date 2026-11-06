# Development

How the code is laid out, which tools check it, and how it is tested ([ADR 002](decisions/002-technology-stack.md), [ADR 003](decisions/003-core.md)).
The commands to run are in the [README](../README.md#development).

## Principles

- Use what a framework or tool offers (e.g. the options of dockview, the conventions of Vite), as simply as possible.
  A workaround is for where there is no other way; it is named as one, next to the native ways, asking upstream included, and replaced when a native way appears.
- A rule or tool that matters fails loudly when broken or switched off: its strictest mode, a test that it runs at all, the hooks (`.githooks/pre-commit` lints; `.githooks/pre-push` runs pyright, pytest and `npm run check`), and CI (`.github/workflows/ci.yml`).
- No backwards compatibility while formats are in flux: a changed file format just changes, with a plain error for the old form, and no migration code or hints.
  Data in the database is worth keeping, so a schema change bumps `SCHEMA_VERSION` and comes with a one-off script that carries the data over ([ADR 003](decisions/003-core.md)); `.agents/scratch/gui-verification/carry-over.py` (not tracked) rebuilds changed tables in place, safe with a running Daemon.
- The package version stays 0.1.0 until things are reasonably stable; only the API version moves ([ADR 004](decisions/004-server.md)).

## Commits

The subject names an area, then an imperative summary, lowercase after the colon, under about 60 characters (72 at most): `gui: add a header menu for hiding and moving columns`.
Areas: `gui`, `core`, `daemon` (the Daemon, the Server and the API), `cli`, `desktop`, `tests`, `docs`, `build`, `ci`, `assets`, `scripts`; the area is where the change mainly lives.
A change of the API version ends the subject with `(API 0.x)`, or goes in the body.
The body gives the details, wrapped at 100 characters at most.

## Python

One Python package, for Python ≥ 3.12, with `pyproject.toml` at the repository root and a src layout.
uv manages the environment; `uv.lock` is committed.
During development, `uv tool install --editable .` puts `hephaistos` on the path, following the current code.
Tools: Typer for the CLI (with shell completion), ruff, pyright and pytest.
The Core keeps its dependencies minimal.
FastAPI and uvicorn are regular dependencies.

## Layout

```
src/hephaistos/
  core/
    config.py     settings: shipped defaults.toml, config files, environment
    serialize.py  entities as JSON, for `--json` and the Server's API
    db/           connection, read and write sessions, schema, raw listings
    registry/     machines.py, filesystems.py, mounts.py, repositories.py, clones.py
    state/        checkouts.py (shared by Clones and Worktrees), clones.py, worktrees.py
    events/       events.py (storage and reading), kinds.py, subjects.py
    observers/    clones.py
    utils/
      errors.py   errors with messages for the user
      ids.py      UUIDv7, hybrid logical clock
      paths.py    XDG directories, per-Machine subdirectory, filesystem type detection
      logs.py     log files: JSON Lines, one per UTC day; records as text
      times.py    points in time as given: `2h` ago, or a date
      git.py      reads facts by running git's commands for scripts; knows nothing about our records
  cli/            one module per subcommand, named like it (clone.py for `hephaistos clone`)
  daemon/{watcher,sync,server}/
  desktop/
  plugins/
```

`tests/test_structure.py` checks what each part imports ([ADR 002](decisions/002-technology-stack.md#components)).
`tests/test_style.py` checks the [style](style.md) that a program can check.
`tests/test_links.py` checks that each link in a Markdown file, and each path under `docs/` named in any file, leads to a file and heading that exist.

## Naming

Core modules about a kind of thing are plural (`clones.py`, `ids.py`), which keeps them apart from variables (`clone`, `id`).
Modules about one thing are singular (`git.py`).
Each entity's dataclass lives next to its SQL.
An operation spanning several modules lives with the entity it mainly concerns.
E.g. adding a Clone takes git facts, a Repository, a Clone and Events, and lives with Clones.

Functions that act are verbs (`add`, `record`, `observe`).
Functions that only return something are named for what they return (`git.status`, `clones.details`, `caused_events`).
Lookups and conversions may be verbs (`get`, `find`, `locate`, `parse_since`, `to_json`).
Predicates read as questions (`is_network`, `shares_history`).
Formatting helpers in the CLI end in `_text` or `_json`.

## GUI

Node comes as a development dependency of the Python project (`nodejs-wheel`), so nothing is installed outside it.
npm, TypeScript (strict), Biome for linting and formatting, and Vitest.
TanStack Query fetches and refreshes data, through openapi-fetch.
Its types are generated from the API's schema, `gui/web/openapi.json`, which the API's schema test records.
`npm run types` also writes what GitHub's Linguist knows of file names (`linguist-languages`, pinned), compactly, for the Explorer's icons (`gui/scripts/linguist.mjs`); neither is in git.
Styles are CSS modules plus one theme file of named values, with no component library so far.
Vite builds into `gui/web/dist/` (not in git), which the Server serves.
`gui/package.json` is one npm package for the GUI and the Desktop, and Electron's app.

React's compiler memoizes components and hooks, strictly.
A component or hook it cannot compile, e.g. one against the Rules of React, fails the build and the tests; a test checks that the compiler runs.
So there is no memoization by hand, which lint rejects.
What must stay as it was, e.g. a diff given to the renderer, is held in state, not memoized.

### Workarounds kept

The GUI cleanup (2026-10-22) replaced workarounds by mechanisms of the frameworks.
These stayed after a look, each for its reason; they are not to be proposed again without something new:

- List rows stay our own (`ListTable`): a probe of `Tree` in React Aria 1.21.1 kept cell buttons, middle clicks, details and keys, but a row with `onAction` cannot have its text selected, and restoring that would bend React Aria.
- `GitRevisionPicker` reads `aria-activedescendant`: React Aria exposes no signal for the focused row.
- `useFolding` sets `scrollTop` itself: `scrollIntoView` scrolls other containers, and `scrollTo` in Pierre needs its private position.
- The jump of Find (`useFound` in `Diff.tsx`): our own offset by bounding rects (`getOffsetInScrollContainer` in Pierre is off in WebKit once scrolled), `scrollTo` of the element itself (that of Pierre clamps by stale heights), tried again until in view (Pierre sizes the diff after drawing, and draws again).
- The count of Find (`useFound` in `Diff.tsx`): `isLineRenderable` in Pierre is asked only once the diff has drawn `[data-line]` elements, since before its first render, and as a placeholder far out of view, it says that every line shows; Pierre has no public "rendered" status nor a callback on expanding.
  `UNCOLLAPSED` is passed as `collapsedContextThreshold`, so that our counting and heights follow the rule of Pierre.
- Line heights in px, holding the height of a diff until drawn, the narrow check by `ResizeObserver`, `unsafeCSS`, and paging by `IntersectionObserver`: the API of Pierre offers no other way.
- The `--icon-lift` translation of icons: the native `text-box: trim-both cap alphabetic` lacks Firefox.
- Reconnecting live updates, and the main process of the Desktop: ours by nature.
- Black patches when dragging the scrollbar of the stacked Diff fast (Electron, dark): content that Chromium has not painted; a background on the scroller, also with `background-attachment: local`, did not help (2026-10-23). Accepted.

Real-browser tests (`*.browser.test.tsx`) guard what these rely on.
Reports for upstream are in [ideas](ideas/gui.md#upstream).

### Dependencies to watch

- `@pierre/diffs` is pinned exactly (1.5.2): young, with frequent releases and sizeable changes.
  Rather than Dependabot: whenever a step touches the Diff View or `components/diff/`, read its changelog since the pin, tell the user what is new and worth having, and upgrade only once they agree.
  On upgrading, check again what `Diff.tsx` relies on: the variables and attributes of `unsafeCSS`, and `metrics.lineHeight` measured in `DiffScroll`, read only when an instance is made, hence the `key`; with wrapping off, Pierre never measures rows, and a wrong height made rows flicker near chunk boundaries with `gui.code.size = 10`.
  `.agents/scratch/gui-verification/steps-flicker.mjs` checks it: one `scrollHeight` across positions.
- The browser tests in WebKit run without Web Workers (`gui/web/src/test/browser.ts`, `provide: { workers }` in `gui/vitest.config.ts`), since 2026-10-22: the WebKit of Playwright (webkit-2370, WPE) crashes when several module workers load a large module (Shiki) at once, round after round, under the Vite dev server.
  Reported as microsoft/playwright#43582 (maybe the same as #42330); a reproduction is in `.agents/scratch/webkit-crash/report/`.
  When Playwright updates WebKit, run it again, and once it no longer crashes, drop the workaround.

## A worktree's GUI

`scripts/worktree_gui.sh` shows a worktree's GUI before it reaches main, in a Desktop window of its own.
It builds the worktree, starts a scratch Daemon from it (`scripts/scratch_daemon.sh`) and opens the window, named after the worktree.
Each worktree has one instance, in `~/.cache/agents/hephaistos/wt/<worktree>/`: its home, port and the window's saved Layout stay across starts.
Its first start copies the real database, as one consistent snapshot, and the config files; `--fresh` copies them again, `--empty` starts without data.
The copy keeps this Machine's identity, so an instance must never sync.
Quitting the window stops its Daemon; `stop`, `remove`, `list` and `prune` manage instances.
The window runs the main checkout's Electron, the one binary that AppArmor lets use Chromium's sandbox, so the worktree must have the same Electron version.
The script refuses to run in the main checkout, whose GUI the real Daemon serves.

Agents may build the GUI in any checkout, main included, but never start, stop or restart the real Daemon: they give the user the commands.
In a worktree, they show their work with `scripts/worktree_gui.sh start`, run outside Claude Code's sandbox: there, Electron gets no user namespaces, and what the command leaves running ends with it.
Before removing their worktree, they run `scripts/worktree_gui.sh remove`.

## Tests

pytest tests the Core, with fake plugins standing in for real tools.
`scripts/test_git_versions.sh` runs them with several git versions.
Vitest and Testing Library test the GUI, in jsdom.
What only a browser lays out, e.g. what the diff renderer draws, is tested in real browsers: Playwright's Chromium, Firefox and WebKit.
Those tests guard what we rely on that the renderer does not promise.
GUI tests reach no Server: each test answers the requests it expects, and any other fails, also after the test ended.
The Vite dev server proxies `/api` to the Server, but not for Vitest.

While working, run the tests of the files changed and the linters; run the whole `npm run check` once, right before a commit, since it starts many workers and real browsers.
A change to the GUI is checked where it shows: browser tests for what only a browser lays out, headless Chrome against a scratch Daemon for how a View looks and behaves, the Desktop for its window and keys, and a tour before and after for changes to styles.
The scripts for this, and how to run them, are in `.agents/scratch/gui-verification/README.md`.
