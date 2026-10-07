import sys
from typing import Annotated

import typer

from hephaistos import __description__, __version__
from hephaistos.cli import clone, db, event, machine, observe, repo, terminal, worktree
from hephaistos.cli.output import short_path
from hephaistos.core.registry import machines
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.paths import Paths

app = typer.Typer(no_args_is_help=True, help=__description__, pretty_exceptions_show_locals=False)
app.add_typer(machine.app, name="machine")
app.add_typer(repo.app, name="repo")
app.add_typer(clone.app, name="clone")
app.add_typer(worktree.app, name="worktree")
app.add_typer(event.app, name="event")
app.add_typer(db.app, name="db")
app.command()(observe.observe)


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


def _confirm_reset(paths: Paths) -> None:
    """Asks before replacing this Machine's database; raises typer.Abort if declined."""
    if not terminal.interactive():
        raise HephaistosError("--reset replaces this Machine's database; confirm with --yes")
    old = machines.previous(paths)
    replaced = f"Machine {old.name} ({old.id})" if old else "The Machine (unreadable)"
    typer.echo("Reset hephaistos on this Machine?")
    typer.echo(f"  {replaced} is replaced by a new one with a new ID.")
    typer.echo(f"  Its database moves to {short_path(paths.database_backup)},")
    typer.echo("  replacing any earlier backup.")
    if not typer.confirm("Continue?", default=False):
        raise typer.Abort


@app.command()
def setup(
    name: Annotated[
        str | None,
        typer.Option(help="Name of this Machine. Default: its hostname, or with --reset its name."),
    ] = None,
    *,
    reset: Annotated[
        bool,
        typer.Option(
            "--reset", help="Set up again, with a new database; the old one is kept as a backup."
        ),
    ] = False,
    yes: Annotated[bool, typer.Option("--yes", help="Reset without asking.")] = False,
) -> None:
    """Set up hephaistos on this Machine: once, or again with --reset."""
    paths = Paths.from_environment()
    replacing = reset and paths.database.exists()
    if replacing and not yes:
        _confirm_reset(paths)
    if reset and not replacing:
        typer.echo("Nothing to reset")
    created = machines.set_up(paths, name, reset=reset)
    typer.echo(f"Set up Machine {created.name} ({created.id}), data in {paths.data_dir}")
    if replacing:
        typer.echo(f"The old database is kept as {short_path(paths.database_backup)}")
