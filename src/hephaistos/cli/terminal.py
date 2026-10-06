"""Talking with the user at a terminal."""

import sys
from collections.abc import Sequence

import typer


def interactive() -> bool:
    """Whether we can ask the user."""
    return sys.stdin.isatty()


def choose(heading: str, options: Sequence[str], prompt: str) -> int:
    """Asks the user to pick one of the numbered options; returns its index."""
    typer.echo(heading)
    for number, option in enumerate(options, start=1):
        typer.echo(f"  {number}  {option}")
    while True:
        number: int = typer.prompt(prompt, type=int)
        if 1 <= number <= len(options):
            return number - 1
