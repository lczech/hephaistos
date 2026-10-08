"""Talking with the user at a terminal."""

import sys
from collections.abc import Sequence

import typer

from hephaistos.core.utils.errors import HephaistosError


def interactive() -> bool:
    """Whether we can ask the user."""
    return sys.stdin.isatty()


def confirm(question: str, *, default: bool, action: str) -> None:
    """Asks the user to confirm; aborts unless they do.

    Without a terminal, raises HephaistosError, naming the `action` that `--yes` would do.
    """
    if not interactive():
        raise HephaistosError(f"not asking without a terminal; add --yes to {action}")
    if not typer.confirm(question, default=default):
        raise typer.Abort


def choose(heading: str, options: Sequence[str], prompt: str) -> int:
    """Asks the user to pick one of the numbered options; returns its index."""
    typer.echo(heading)
    for number, option in enumerate(options, start=1):
        typer.echo(f"  {number}  {option}")
    while True:
        number: int = typer.prompt(prompt, type=int)
        if 1 <= number <= len(options):
            return number - 1
