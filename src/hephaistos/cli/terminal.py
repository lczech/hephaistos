"""`hephaistos terminal`: Terminals, shells on this Machine that outlive what shows them."""

import logging
import os
import shlex
import sys
from collections.abc import Callable, Sequence
from datetime import datetime
from pathlib import Path
from typing import Annotated, NoReturn

import typer

from hephaistos.cli import tty
from hephaistos.cli.output import (
    JsonOption,
    TimeFormatOption,
    full_time,
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

log = logging.getLogger(__name__)

app = typer.Typer(
    no_args_is_help=True, help="Terminals: shells on this machine that outlive what shows them."
)

NameArgument = Annotated[str, typer.Argument(help="Name of the terminal.")]


def _observed(paths: Paths) -> str | None:
    """Observes first: Terminals change between the passes of the Watcher, e.g. by `exit`.

    Returns why it could not, if so; `_said_unobserved` says it, once the Terminals are read.
    """
    return observer.observe(paths).error


def _said_unobserved(error: str | None, found: Sequence[TerminalState]) -> None:
    """Says that the Terminals could not be observed, and when they last were."""
    if error is None:
        return
    seen = max((state.observed_at.datetime for state in found), default=None)
    when = "" if seen is None else f", at {full_time(seen)}"
    typer.echo(f"terminals not observed: {error}; showing them as last observed{when}", err=True)


def _command_text(state: TerminalState) -> str:
    return "-" if state.command is None else escaped(shlex.join(state.command))


def _repository(checkout: CheckoutDetails | None) -> str:
    return "-" if checkout is None else checkout.clone.repository.name


def _status_text(state: TerminalState) -> str:
    """Its status, with how an ended one ended or why a lost one went.

    E.g. `ended (status 1)`, `ended (SIGKILL)`, `lost (machine restarted)`.
    """
    if state.status is terminals.TerminalStatus.LOST and state.lost_because is not None:
        return f"lost ({terminals.LOST_TEXTS[state.lost_because].removeprefix('the ')})"
    if state.status is not terminals.TerminalStatus.ENDED:
        return state.status.value
    how = terminals.ending_text(state)
    return f"ended ({how.removeprefix('exited with ').removeprefix('ended by ')})"


def _attach_text(state: TerminalState) -> str:
    """How to attach to it later."""
    return shlex.join(["hephaistos", "terminal", "attach", state.name])


def _attachable() -> None:
    if not tty.attachable():
        raise HephaistosError(
            "this command attaches only when run interactively; run it in a terminal emulator"
        )


def _become(command: list[str]) -> NoReturn:
    """Becomes `command`, e.g. plain `tmux attach-session`, logging that this command ends."""
    log.info("end: becomes %s", shlex.join(command))
    sys.stdout.flush()
    os.execvp(command[0], command)  # noqa: S606 - tmux, as the settings name it


def _attached(paths: Paths, name: str) -> NoReturn:
    """Becomes plain `tmux attach-session` to the Terminal, restored first if it was lost."""
    _attachable()
    _, command = actions.attach(paths, name, tty=tty.terminal_name())
    _become(command)


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
        _become(actions.attach_created(paths, created, tty=tty.terminal_name()))
    running = "" if created.command is None else f", running {_command_text(created)}"
    typer.echo(
        f"Created terminal {escaped(created.name)} in {short_path(created.directory)}{running}"
    )
    if created.status is terminals.TerminalStatus.ENDED:
        typer.echo(f"  it ended at once: {terminals.ending_text(created)}")
        typer.echo(f"  see its last screen with: {_attach_text(created)}")
        return
    typer.echo(f"  attach with: {_attach_text(created)}")


@app.command()
def attach(name: NameArgument) -> None:
    """Attach to a terminal with tmux; a lost one is restored first, as a shell.

    Plain tmux: Ctrl+B d detaches, and leaves the terminal running. An ended one shows its last
    screen, until killed.
    """
    _attached(Paths.from_environment(), name)


@app.command("list")
def list_(*, time_format: TimeFormatOption = None, as_json: JsonOption = False) -> None:
    """List the terminals of this machine."""
    paths = Paths.from_environment()
    error = _observed(paths)
    with read_session(paths) as session:
        found = terminals.on_this_machine(session)
        _said_unobserved(error, found)
        if as_json:
            print_json(serialize.terminals_json(session))
            return
        known = clones.on_this_machine(session)
        checkouts = [clones.recorded_checkout(session, state.directory, known) for state in found]
    formatted = time_formatter(time_format, TimeFormat.RELATIVE)
    print_table(
        ["name", "status", "repo", "directory", "program", "attached", "active"],
        [
            [
                escaped(state.name),
                _status_text(state),
                _repository(checkout),
                short_path(state.directory),
                escaped(state.program) or "-",
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
    error = _observed(paths)
    with read_session(paths) as session:
        state = terminals.by_name(session, name)
        _said_unobserved(error, [state])
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
            *_ending_fields(state, formatted),
            ("directory", short_path(state.directory)),
            ("current", "-" if current is None else short_path(current)),
            ("program", escaped(state.program) or "-"),
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


def _ending_fields(
    state: TerminalState, formatted: Callable[[datetime], str]
) -> list[tuple[str, str]]:
    """How an ended one ended, and when and why the session of one went, as far as known."""
    fields: list[tuple[str, str]] = []
    if state.status is terminals.TerminalStatus.ENDED and state.ended_at is not None:
        fields.append(("ended", f"{formatted(state.ended_at)}: {terminals.ending_text(state)}"))
    if state.lost_at is not None and state.lost_because is not None:
        why = terminals.LOST_TEXTS[state.lost_because]
        label = "lost" if state.status is terminals.TerminalStatus.LOST else "screen"
        gone = "" if label == "lost" else "gone "
        fields.append((label, f"{gone}{formatted(state.lost_at)}: {why}"))
    return fields


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
    """End a terminal and what runs in it, or remove one that ended or was lost."""
    killed = actions.kill(Paths.from_environment(), name, force=force)
    if killed.status is terminals.TerminalStatus.OPEN:
        typer.echo(f"Killed terminal {escaped(killed.name)}")
    else:
        typer.echo(f"Removed {killed.status.value} terminal {escaped(killed.name)}")
