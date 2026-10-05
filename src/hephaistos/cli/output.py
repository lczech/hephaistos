"""Plain text and JSON output."""

import json
from collections.abc import Sequence
from datetime import datetime
from pathlib import Path
from typing import Annotated

import typer

JsonOption = Annotated[bool, typer.Option("--json", help="Output as JSON.")]


def short_path(path: Path) -> str:
    """The path with the home directory shortened to ~."""
    home = Path.home()
    if path == home:
        return "~"
    if path.is_relative_to(home):
        return f"~/{path.relative_to(home)}"
    return str(path)


def full_time(value: datetime) -> str:
    """A point in time in local time, e.g. `2026-10-05 14:03:21`."""
    return value.astimezone().strftime("%Y-%m-%d %H:%M:%S")


def print_fields(fields: Sequence[tuple[str, str]]) -> None:
    """Prints `label  value` lines, with the values aligned."""
    width = max((len(label) for label, _ in fields), default=0)
    for label, value in fields:
        typer.echo(f"{label:<{width}}  {value}")


def print_table(headers: Sequence[str], rows: Sequence[Sequence[str]]) -> None:
    """Prints rows under a header line, with the columns aligned."""
    widths = [max(len(row[column]) for row in (headers, *rows)) for column in range(len(headers))]
    for row in (headers, *rows):
        typer.echo(
            "  ".join(f"{cell:<{width}}" for cell, width in zip(row, widths, strict=True)).rstrip()
        )


def print_json(value: object) -> None:
    """Prints a value as indented JSON."""
    typer.echo(json.dumps(value, indent=2))
