"""Talking with the user at a terminal."""

import os
import shlex
import subprocess
import sys
from collections.abc import Sequence

import typer

from hephaistos.core.utils.errors import HephaistosError

PAGER = "less"
LESS = "FRX"  # as git sets it: quit if it fits on one screen, keep colours, leave it shown


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


def page(text: str) -> None:
    """Prints `text`; on a terminal through $PAGER (else less), as git does."""
    if not sys.stdout.isatty():
        typer.echo(text)
        return
    command = shlex.split(os.environ.get("PAGER") or PAGER)
    env = os.environ | {"LESS": os.environ.get("LESS", LESS)}
    try:
        subprocess.run(command, input=text + "\n", text=True, env=env, check=False)  # noqa: S603 - the user's pager
    except OSError:
        typer.echo(text)
