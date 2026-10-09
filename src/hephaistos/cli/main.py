import logging
import os
import shlex
import sys
import time
from pathlib import Path
from typing import Annotated

import typer

from hephaistos import __description__, __version__
from hephaistos.cli import (
    clone,
    db,
    event,
    log,
    machine,
    observe,
    repo,
    scan,
    terminal,
    worktree,
)
from hephaistos.cli import config as config_command
from hephaistos.cli.output import short_path
from hephaistos.core import config
from hephaistos.core.config import ConfigError
from hephaistos.core.registry import machines
from hephaistos.core.utils import logs
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.paths import Paths

DEBUG_OPTION = "--debug"
# What a run's exit code tells, for its log; ours are reported as errors before exiting.
OUTCOMES = {0: "ok", 1: "aborted", 2: "usage", 130: "interrupted"}
# Commands that run on the default settings if the config is broken: to look into it.
ON_DEFAULTS = frozenset({"log", "config"})
SHOWS_CONFIG = "config"  # reports a broken config itself

logger = logging.getLogger(__name__)

app = typer.Typer(
    no_args_is_help=True,
    help=__description__,
    pretty_exceptions_show_locals=False,
    rich_markup_mode="markdown",  # rewraps docstrings' paragraphs; `code` as code
)
app.add_typer(machine.app, name="machine")
app.add_typer(repo.app, name="repo")
app.add_typer(clone.app, name="clone")
app.add_typer(worktree.app, name="worktree")
app.add_typer(event.app, name="event")
app.add_typer(db.app, name="db")
app.add_typer(log.app, name="log")
app.add_typer(config_command.app, name="config")
app.command()(observe.observe)
app.command()(scan.scan)


def without_debug(args: list[str]) -> tuple[list[str], bool]:
    """The arguments without `--debug`, accepted anywhere before `--`, and whether it was there."""
    end = args.index("--") if "--" in args else len(args)
    kept = [arg for arg in args[:end] if arg != DEBUG_OPTION]
    return kept + args[end:], len(kept) < end


def _check_config(args: list[str], problem: ConfigError) -> None:
    """Raises a broken config's problem, or warns if the command runs on the defaults anyway.

    Showing help or the version needs no settings, and ON_DEFAULTS help to look into it.
    """
    head = args[: args.index("--")] if "--" in args else args
    if head and head[0] not in ON_DEFAULTS and {"--help", "--version"}.isdisjoint(head):
        raise problem
    if head[:1] != [SHOWS_CONFIG]:
        typer.echo(f"warning: {problem}; using the defaults", err=True)


def _invoke(
    args: list[str], logged: logs.DayFileHandler, problem: ConfigError | None
) -> tuple[int | str | None, str]:
    """Runs the command; returns its exit code and outcome, having reported any error."""
    try:
        if problem is not None:
            _check_config(args, problem)
        app(args)
    except SystemExit as stop:
        code = stop.code
        if code is None or isinstance(code, int):
            return code, OUTCOMES.get(code or 0, f"exit {code}")
        return code, f"error: {code}"  # a message, exiting with 1
    except HephaistosError as error:
        typer.echo(f"error: {error}", err=True)
        return 1, f"error: {error}"
    except Exception as error:
        logger.exception("unexpected %s", type(error).__name__)
        typer.echo(f"error: unexpected {type(error).__name__}: {error}", err=True)
        if logged.failure is not None:
            raise  # the traceback can't go to the log
        typer.echo(f"details: hephaistos log show --pid {os.getpid()}", err=True)
        return 1, "unexpected"
    return 0, "ok"


def run() -> None:
    """Entry point: runs a command and logs it; our own errors are messages, not tracebacks.

    Settings are loaded first; a broken config stops all commands but `--help`, `--version` and
    those in ON_DEFAULTS. With `--debug`, this run logs at debug level and also shows its records
    on stderr.
    `log` commands log only what goes wrong, so that showing the log doesn't add to it.
    """
    args, debug = without_debug(sys.argv[1:])
    paths = Paths.from_environment()
    problem = None
    try:
        settings = config.load(paths.config_dir).settings
    except ConfigError as error:
        problem, settings = error, config.DEFAULTS
    config.activate(settings)
    logged = logs.DayFileHandler(paths.state_dir, "cli")
    handlers: list[logging.Handler] = [logged]
    if debug:
        shown = logging.StreamHandler(sys.stderr)
        shown.setFormatter(log.TextFormatter("cli"))
        handlers.append(shown)
    logs.start(handlers, logging.DEBUG if debug else settings.log.level.number)
    started = time.monotonic()
    command = shlex.join(["hephaistos", *args])
    quiet = args[:1] == ["log"]
    if not quiet:
        logger.info("start: %s", command, extra={"version": __version__, "cwd": Path.cwd()})
    try:
        code, outcome = _invoke(args, logged, problem)
        duration = round(time.monotonic() - started, 3)
        if not quiet:
            logger.info("end: %s", outcome, extra={"exit_code": code, "duration": duration})
    finally:
        if logged.failure is not None:
            typer.echo(f"warning: cannot write the log: {logged.failure}", err=True)
        logs.stop()
    sys.exit(code)


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
    debug: Annotated[  # `run` takes it, from anywhere in the command
        bool,
        typer.Option(
            DEBUG_OPTION, help="Log details of this run and show them on stderr; also at the end."
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
