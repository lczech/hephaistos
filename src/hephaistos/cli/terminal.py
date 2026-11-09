"""`hephaistos terminal`: Terminals, shells on this Machine that outlive what shows them."""

import os
import shlex
import sys
from pathlib import Path
from typing import Annotated, NoReturn

import typer

from hephaistos.cli import tty
from hephaistos.cli.output import (
    JsonOption,
    TimeFormatOption,
    print_fields,
    print_json,
    print_table,
    time_formatter,
)
from hephaistos.core import serialize
from hephaistos.core.config import TimeFormat
from hephaistos.core.db.sessions import read_session
from hephaistos.core.observers import terminals as observer
from hephaistos.core.registry import clones
from hephaistos.core.registry.clones import CheckoutDetails
from hephaistos.core.state import terminals
from hephaistos.core.state.terminals import TerminalState
from hephaistos.core.terminals import actions
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.paths import Paths, short_path
from hephaistos.core.utils.text import escaped

app = typer.Typer(
    no_args_is_help=True, help="Terminals: shells on this machine that outlive what shows them."
)

NameArgument = Annotated[str, typer.Argument(help="Name of the terminal.")]


def _observed(paths: Paths) -> None:
    """Observes first: Terminals change between the passes of the Watcher, e.g. by `exit`."""
    result = observer.observe(paths)
    if result.error is not None:
        typer.echo(f"terminals not observed: {result.error}; showing them as last seen", err=True)


def _command_text(state: TerminalState) -> str:
    return "-" if state.command is None else escaped(shlex.join(state.command))


def _repository(checkout: CheckoutDetails | None) -> str:
    return "-" if checkout is None else checkout.clone.repository.name


def _attach_text(state: TerminalState) -> str:
    """How to attach to it later."""
    return shlex.join(["hephaistos", "terminal", "attach", state.name])


def _attached(paths: Paths, name: str) -> NoReturn:
    """Becomes plain `tmux attach-session` to the Terminal, restored first if it was lost."""
    if not tty.attachable():
        raise HephaistosError(
            "this command attaches only when run interactively; run it in a terminal emulator"
        )
    _, command = actions.attach(paths, name)
    sys.stdout.flush()
    os.execvp(command[0], command)  # noqa: S606 - tmux, as the settings name it


@app.command(context_settings={"allow_interspersed_args": False})
def create(
    command: Annotated[
        list[str] | None,
        typer.Argument(help="What it runs, after `--`; else your login shell.", show_default=False),
    ] = None,
    *,
    name: Annotated[
        str | None,
        typer.Option("--name", "-n", help="Its name; else the directory name, numbered: proj-1."),
    ] = None,
    directory: Annotated[
        Path, typer.Option("--dir", "-d", help="Where it starts.", show_default="this one")
    ] = Path(),
    detached: Annotated[
        bool,
        typer.Option(
            "--detached",
            help="Leave it running without attaching; when not run interactively, always.",
        ),
    ] = False,
) -> None:
    """Create a terminal, running your shell or a command, and attach to it."""
    paths = Paths.from_environment()
    created = actions.create(paths, directory, name=name, command=command)
    if not detached and tty.attachable():
        _attached(paths, created.name)
    running = "" if created.command is None else f", running {_command_text(created)}"
    typer.echo(
        f"Created terminal {escaped(created.name)} in {short_path(created.directory)}{running}"
    )
    typer.echo(f"  attach with: {_attach_text(created)}")


@app.command()
def attach(name: NameArgument) -> None:
    """Attach to a terminal with tmux; a lost one is restored first, as a shell.

    Plain tmux: Ctrl+B d detaches, and leaves the terminal running.
    """
    _attached(Paths.from_environment(), name)


@app.command("list")
def list_(*, time_format: TimeFormatOption = None, as_json: JsonOption = False) -> None:
    """List the terminals of this machine."""
    paths = Paths.from_environment()
    _observed(paths)
    with read_session(paths) as session:
        if as_json:
            print_json(serialize.terminals_json(session))
            return
        found = terminals.on_this_machine(session)
        known = clones.on_this_machine(session)
        checkouts = [clones.recorded_checkout(session, state.directory, known) for state in found]
    formatted = time_formatter(time_format, TimeFormat.RELATIVE)
    print_table(
        ["name", "status", "repo", "directory", "program", "attached", "active"],
        [
            [
                escaped(state.name),
                state.status.value,
                _repository(checkout),
                short_path(state.directory),
                escaped(state.program),
                str(state.clients) if state.clients else "-",
                formatted(state.active_at),
            ]
            for state, checkout in zip(found, checkouts, strict=True)
        ],
    )


@app.command()
def show(
    name: NameArgument, *, time_format: TimeFormatOption = None, as_json: JsonOption = False
) -> None:
    """Show a terminal: where it started, what runs in it, and its checkout."""
    paths = Paths.from_environment()
    _observed(paths)
    with read_session(paths) as session:
        state = terminals.by_name(session, name)
        if as_json:
            print_json(serialize.terminal_json(session, state))
            return
        checkout = clones.recorded_checkout(session, state.directory)
    formatted = time_formatter(time_format, TimeFormat.FULL)
    current = state.current_directory
    where = None
    if checkout is not None:
        worktree = checkout.worktree
        where = checkout.clone.clone.display_path if worktree is None else worktree.path
    print_fields(
        [
            ("name", escaped(state.name)),
            ("id", str(state.id)),
            ("status", state.status.value),
            ("directory", short_path(state.directory)),
            ("current", "-" if current is None else short_path(current)),
            ("program", escaped(state.program)),
            ("command", _command_text(state)),
            ("attached", str(state.clients)),
            *([("panes", str(state.panes))] if state.panes > 1 else []),
            ("repository", _repository(checkout)),
            ("checkout", "-" if where is None else short_path(where)),
            ("started", formatted(state.started_at)),
            ("active", formatted(state.active_at)),
            ("observed", formatted(state.observed_at.datetime)),
        ]
    )


@app.command()
def rename(
    name: NameArgument,
    new_name: Annotated[str, typer.Argument(help="Its new name.", show_default=False)],
) -> None:
    """Rename a terminal."""
    renamed = actions.rename(Paths.from_environment(), name, new_name)
    typer.echo(f"Renamed terminal {escaped(name)} to {escaped(renamed.name)}")


@app.command()
def kill(
    name: NameArgument,
    *,
    force: Annotated[
        bool, typer.Option("--force", help="SIGKILL first, also for what ignores SIGHUP.")
    ] = False,
) -> None:
    """End a terminal and what runs in it; a lost one is forgotten."""
    killed = actions.kill(Paths.from_environment(), name, force=force)
    lost = killed.status is terminals.TerminalStatus.LOST
    typer.echo(f"{'Forgot lost' if lost else 'Killed'} terminal {escaped(killed.name)}")
