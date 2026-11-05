# Development

How the code is laid out, which tools check it, and how it is tested ([ADR 002](decisions/002-technology-stack.md), [ADR 003](decisions/003-core.md)).
The commands to run are in the [README](../README.md#development).

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
Styles are CSS modules plus one theme file of named values, with no component library so far.
Vite builds into `gui/web/dist/` (not in git), which the Server serves.
`gui/package.json` is one npm package for the GUI and the Desktop, and Electron's app.

React's compiler memoizes components and hooks, strictly.
A component or hook it can't compile, e.g. one against the Rules of React, fails the build and the tests; a test checks that the compiler runs.
So there is no memoization by hand, which lint rejects.
What must stay as it was, e.g. a diff given to the renderer, is held in state, not memoized.

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
Those tests guard what we rely on that the renderer doesn't promise.
GUI tests reach no Server: each test answers the requests it expects, and any other fails, also after the test ended.
Vite's dev server proxies `/api` to the Daemon's, but not for Vitest.
