import sys
from typing import Annotated

import typer

from hephaistos import __description__, __version__
from hephaistos.cli import machine
from hephaistos.core.errors import HephaistosError
from hephaistos.core.paths import Paths
from hephaistos.core.registry import machines

app = typer.Typer(no_args_is_help=True, help=__description__, pretty_exceptions_show_locals=False)
app.add_typer(machine.app, name="machine")


def run() -> None:
    """Entry point: our own errors are reported as a message, not a traceback."""
    try:
        app()
    except HephaistosError as error:
        typer.echo(f"error: {error}", err=True)
        sys.exit(1)


def _print_version(*, value: bool) -> None:
    """Prints the version and stops, if `--version` was given."""
    if value:
        typer.echo(f"hephaistos {__version__}")
        raise typer.Exit


@app.callback()
def main(
    *,
    version: Annotated[
        bool,
        typer.Option(
            "--version", callback=_print_version, is_eager=True, help="Show the version and exit."
        ),
    ] = False,
) -> None:
    """Options that apply to all commands."""


@app.command()
def setup(
    name: Annotated[
        str | None, typer.Option(help="Name of this Machine. Default: its hostname.")
    ] = None,
) -> None:
    """Set up hephaistos on this Machine (once)."""
    paths = Paths.from_environment()
    created = machines.set_up(paths, name)
    typer.echo(f"Set up Machine {created.name} ({created.id}), data in {paths.data_dir}")
