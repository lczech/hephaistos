# hephaistos

A workbench for managing repositories, terminals, and agents across distributed machines. Early development; see [AGENTS.md](AGENTS.md) and [docs/](docs/).

## Setup

Requires [uv](https://docs.astral.sh/uv/).

```sh
uv tool install --editable .     # puts `hephaistos` on the path, following the current code
hephaistos --install-completion  # optional: tab completion
```

## Development

```sh
uv run pytest
uv run ruff check . && uv run ruff format .
uv run pyright
```
