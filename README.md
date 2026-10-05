# hephaistos

A workbench for managing repositories, terminals, and agents across distributed machines. Early development; see [AGENTS.md](AGENTS.md) and [docs/](docs/).

## Setup

Requires [uv](https://docs.astral.sh/uv/).

```sh
uv tool install --editable .     # puts `hephaistos` on the path, following the current code
hephaistos --install-completion  # optional: tab completion
hephaistos setup                 # once per Machine
hephaistos machine show
hephaistos repo add hephaistos
hephaistos clone add ~/Repos/hephaistos -r hephaistos
hephaistos clone list
hephaistos event list
```

## Development

```sh
git config core.hooksPath .githooks   # once: ruff before each commit; pyright, pytest before each push
uv run pytest
uv run ruff check . && uv run ruff format .
uv run pyright
```

Set `HEPHAISTOS_HOME` to a scratch directory to keep experiments away from your real data, e.g. `HEPHAISTOS_HOME=/tmp/heph hephaistos setup`.
