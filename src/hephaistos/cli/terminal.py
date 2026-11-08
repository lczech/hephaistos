"""Talking with the user at a terminal."""

import os
import shlex
import subprocess
import sys
from collections.abc import Sequence

import typer

from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.installation import Difference, value_text

PAGER = "less"
LESS = "FRX"  # as git sets it: quit if it fits on one screen, keep colours, leave it shown


def interactive() -> bool:
    """Whether we can ask the user."""
    return sys.stdin.isatty()


def confirm(question: str, *, default: bool, action: str) -> None:
    """Asks the user to confirm; aborts unless they do.

    When not run interactively, raises HephaistosError, naming the `action` that `--yes` would do.
    """
    if not interactive():
        raise HephaistosError(
            "this command asks for confirmation only when run interactively;"
            f" add --yes to {action} without asking"
        )
    if not typer.confirm(question, default=default):
        raise typer.Abort


def confirm_other_installation(
    heading: str, differences: Sequence[Difference], *, installed: str, action: str
) -> None:
    """If an installed part belongs to another installation, shows how, and confirms `action`.

    `heading` introduces the differences; `installed` labels the side of the installed part,
    e.g. `unit`, beside that of this command.
    """
    if not differences:
        return
    typer.echo(heading)
    labels = (f"{installed}:", "this command:")
    width = max(len(label) for label in labels) + 2
    for difference in differences:
        typer.echo(f"  {difference.name}")
        typer.echo(f"    {labels[0]:<{width}}{value_text(difference.installed)}")
        typer.echo(f"    {labels[1]:<{width}}{value_text(difference.current)}")
    confirm(f"{action[0].upper()}{action[1:]}?", default=False, action=action)


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
