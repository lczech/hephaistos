<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="assets/logo-light.png">
  <img alt="hephaistos" src="assets/logo-light.png">
</picture>

# hephaistos

A workbench for managing repositories, terminals, and agents across distributed machines. Early development; see [AGENTS.md](AGENTS.md) and [docs/](docs/).

## Setup

Requires [uv](https://docs.astral.sh/uv/).

```sh
uv tool install --editable .     # puts `hephaistos` on the path, following the current code
uv run npm --prefix gui ci                  # in the checkout: the GUI's packages, again when they change
uv run npm --prefix gui run fetch-electron  # once per Electron version: its binary, for the Desktop
uv run npm --prefix gui run build           # the GUI, served by the Daemon, and the Desktop
hephaistos setup                 # once per Machine, again to update: database, Daemon service, Desktop
hephaistos --install-completion  # optional: tab completion
hephaistos machine show
hephaistos repo add hephaistos
hephaistos clone add ~/Repos/hephaistos -r hephaistos
hephaistos scan ~/Repos             # adds all clones there, with new Repositories where needed
hephaistos clone list
hephaistos worktree list
hephaistos observe
hephaistos event list --repo hephaistos
hephaistos db tables                # the database as stored; `db dump <table>` for its rows
hephaistos daemon install --linger # optional: the Daemon from boot on, not only from login
hephaistos daemon status
curl -H "Authorization: Bearer $(hephaistos daemon token)" 127.0.0.1:8264/api/repositories
hephaistos browse                  # the GUI in your browser
hephaistos desktop open            # the GUI in its own window, also from the desktop's app list
```

## Development

```sh
git config core.hooksPath .githooks   # once: linters before each commit, type checks and tests before each push
uv run pytest
uv run ruff check . && uv run ruff format .
uv run pyright
uv run npm --prefix gui run fetch-browsers  # once per Playwright version: the browsers some GUI tests run in
uv run npm --prefix gui run check   # the GUI's and the Desktop's types and tests; `run lint`, `run format`: Biome
uv run npm --prefix gui run dev     # the GUI at http://127.0.0.1:5173/#token=…, reloading on changes
```

The tool installed with `--editable` runs the current code, but keeps the dependencies it was installed with: after they change, `uv tool install --reinstall --editable .`. The Daemon keeps the code it started with: `hephaistos daemon restart` after changes (`daemon status` shows its version and commit).

`scripts/test_git_versions.sh [version...]` runs the tests with these git versions (default: those on our Machines, 2.43.7, 2.47.3 and 2.53.0), each built once from source into `~/.cache/hephaistos/git`.

`uv run scripts/bench_observe.py ~/Repos --synthetic 6` times observing the repositories found there, plus synthetic ones with Worktrees, in a temporary home.

Set `HEPHAISTOS_HOME` to a scratch directory to keep experiments away from your real data, e.g. `HEPHAISTOS_HOME=/tmp/heph hephaistos setup`. `scripts/scratch_daemon.sh start|stop|status` runs a Daemon from the checkout that way, in `/tmp/hephaistos-scratch` on port 8299, without touching the real one.

`uv run scripts/watch_live.py` prints the hints and heartbeats that the Server sends to GUIs (`--port` for another Server).
