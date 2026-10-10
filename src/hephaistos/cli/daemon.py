"""`hephaistos daemon`: the background process that keeps this Machine's State fresh."""

import base64
import os
import sys
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated

import typer

from hephaistos.cli.output import (
    TimeFormatOption,
    chosen_time_format,
    print_fields,
    short_path,
    time_formatter,
)
from hephaistos.core import config
from hephaistos.core.config import TimeFormat
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.paths import Paths
from hephaistos.daemon import status as daemon_status
from hephaistos.daemon import unit
from hephaistos.daemon.status import Status
from hephaistos.daemon.unit import ForeignUnitError, UnitState

NOT_RUNNING = 3  # `status`'s exit code, as systemctl's
STALLED_PASSES = 3  # intervals, plus git.timeout, after which a pass is overdue

VERSE = "RGVtb25zIHJ1biB3aGVuIGEgZ29vZCBtYW4gZ29lcyB0byB3YXIsCk5pZ2h0IHdpbGwgZmFsbCBhbmQgZHJvd24gdGhlIHN1biwKV2hlbiBhIGdvb2QgbWFuIGdvZXMgdG8gd2FyLgoKRnJpZW5kc2hpcCBkaWVzIGFuZCB0cnVlIGxvdmUgbGllcywKTmlnaHQgd2lsbCBmYWxsLCBhbmQgdGhlIGRhcmsgd2lsbCByaXNlLApXaGVuIGEgZ29vZCBtYW4gZ29lcyB0byB3YXIuCgpEZW1vbnMgcnVuLCBidXQgY291bnQgdGhlIGNvc3Q7ClRoZSBiYXR0bGUncyB3b24sIGJ1dCB0aGUgY2hpbGQgaXMgbG9zdC4="  # noqa: E501 - one encoded verse

app = typer.Typer(
    no_args_is_help=True,
    help="The Daemon: observes this Machine in the background.",
)


@app.command()
def run(
    *,
    doctor_who: Annotated[bool, typer.Option("--doctor-who", hidden=True)] = False,
) -> None:
    """Run the Daemon in the foreground, until stopped (Ctrl+C or SIGTERM).

    It runs the parts its settings enable: the Watcher observes this Machine's Clones every
    watcher.interval seconds, with git at low priority. One Daemon runs per Machine.
    """
    if doctor_who:
        typer.echo(base64.b64decode(VERSE).decode())
        return
    from hephaistos.daemon import main as daemon  # noqa: PLC0415 - only this command needs it

    daemon.run(Paths.from_environment(), lambda text: typer.echo(text, err=True))


def _executable() -> Path:
    """The hephaistos running now, by the path it was run as: links stay links."""
    path = Path(os.path.abspath(sys.argv[0]))  # noqa: PTH100 - Path.absolute keeps `..`
    if not path.is_file():
        raise HephaistosError(f"can't tell which hephaistos runs ({sys.argv[0]})")
    return path


def _linger_text() -> str:
    """Whether linger is on, and what that means for the Daemon."""
    if unit.has_linger():
        return "Linger is on: the Daemon starts at boot and keeps running after logout."
    return (
        "Linger is off: the Daemon starts at login and stops at logout;"
        " `hephaistos daemon install --linger` keeps it running."
    )


@app.command()
def install(
    *,
    linger: Annotated[
        bool,
        typer.Option("--linger", help="Also start it at boot and keep it after logout (loginctl)."),
    ] = False,
) -> None:
    """Install the Daemon as a systemd user service, and start it; again to update it.

    The service runs this hephaistos, by the path it was run as, with this shell's
    HEPHAISTOS_HOME and XDG directories. It starts at login, or with --linger at boot.
    """
    paths = Paths.from_environment()
    previous = daemon_status.read(paths.state_dir)
    running = previous.pid if previous and daemon_status.is_running(paths.state_dir) else None
    done = unit.install(_executable(), os.environ)
    where = short_path(unit.unit_file())
    if done.created:
        typer.echo(f"Installed {where}")
    elif done.added or done.removed:
        typer.echo(f"Updated {where}:")
        for line in done.removed:
            typer.echo(f"  - {line}")
        for line in done.added:
            typer.echo(f"  + {line}")
    else:
        typer.echo(f"Already installed: {where}")
    pid = unit.wait_started(paths, running if done.restarted else None)
    typer.echo(f"The Daemon {'restarted' if done.restarted else 'runs'} (pid {pid})")
    for name in unit.settings_variables(os.environ):
        typer.echo(f"warning: the Daemon won't see {name}; put it in config.toml", err=True)
    if linger:
        unit.enable_linger()
    typer.echo(_linger_text())


@app.command()
def uninstall() -> None:
    """Stop the Daemon and remove its systemd user service."""
    if not unit.uninstall():
        typer.echo("Not installed")
        return
    typer.echo(f"Stopped the Daemon and deleted {short_path(unit.unit_file())}")
    if unit.has_linger():
        typer.echo(
            "Linger stays on, for all your user services; `loginctl disable-linger` ends it."
        )


@app.command()
def start() -> None:
    """Start the installed Daemon through systemd."""
    pid = unit.start(Paths.from_environment())
    typer.echo(f"The Daemon runs (pid {pid})")


@app.command()
def stop() -> None:
    """Stop the Daemon, also one started with `daemon run`; it starts again at the next login."""
    pid = unit.stop(Paths.from_environment())
    typer.echo("The Daemon isn't running" if pid is None else f"Stopped the Daemon (pid {pid})")


@app.command()
def restart() -> None:
    """Restart the installed Daemon, e.g. to apply new code or settings."""
    pid = unit.restart(Paths.from_environment())
    typer.echo(f"The Daemon runs again (pid {pid})")


def _unit_text(state: UnitState | None, installed: str | None) -> str:
    """The `Unit` line of `status`."""
    if state is None:
        return "systemd not available"
    if installed is None or not state.installed:
        return "not installed"
    active = state.active
    if active == "failed" and state.exit_code:
        active += f" (exit code {state.exit_code})"
    enabled = "enabled" if state.enabled else "disabled"
    return f"installed, {enabled}, {active}; linger {'on' if unit.has_linger() else 'off'}"


def _daemon_text(
    found: Status | None, *, running: bool, under_systemd: bool, when: Callable[[datetime], str]
) -> str:
    """The `Daemon` line of `status`."""
    if running:
        how = "running" if under_systemd else "running (not under systemd)"
        if found is None or found.stopped_at is not None:
            return how
        return f"{how}, pid {found.pid}, started {when(found.started_at)}, version {found.version}"
    if found is None:
        return "not running; never ran"
    if found.stopped_at is not None:
        return f"not running; stopped {when(found.stopped_at)}"
    seen = max([found.started_at, *(done.finished_at for done in found.parts.values() if done)])
    return f"not running; ended without stopping, last seen {when(seen)}"


def _watcher_text(found: Status, now: datetime, when: Callable[[datetime], str]) -> str | None:
    """The `Watcher` line of `status`; None if the Daemon doesn't run the Watcher."""
    if "watcher" not in found.parts:
        return None
    done = found.parts["watcher"]
    if done is None:
        return "first pass running"
    settings = config.settings()
    interval = settings.watcher.interval
    age = (now - done.finished_at).total_seconds()
    if age > STALLED_PASSES * interval + settings.git.timeout:
        return f"stalled: last pass {when(done.finished_at)}, every {interval:g} s"
    text = f"last pass {when(done.finished_at)} ({done.duration:g} s)"
    if done.error is not None:
        text += f", failed: {done.error}"
    return f"{text}; next in {max(0, round(interval - age))} s"


@app.command()
def status(time_format: TimeFormatOption = None) -> None:
    """Show whether the Daemon runs, how it is installed, and how its last passes went.

    Exits with 0 if it runs, 3 if not.
    """
    paths = Paths.from_environment()
    now = datetime.now(UTC)
    shown = time_formatter(time_format, TimeFormat.RELATIVE, now)
    relative = chosen_time_format(time_format, TimeFormat.RELATIVE) is TimeFormat.RELATIVE

    def when(at: datetime) -> str:
        text = shown(at)
        if not relative:
            return f"at {text}"
        return text if text == "now" else f"{text} ago"

    state = unit.unit_state()
    warnings: list[str] = []
    try:
        installed = unit.installed_text()
    except ForeignUnitError as error:
        installed = None
        warnings.append(str(error))
    running = daemon_status.is_running(paths.state_dir)
    found = daemon_status.read(paths.state_dir)
    under_systemd = state is not None and state.active == "active"
    fields = [
        ("Unit", _unit_text(state, installed)),
        ("Daemon", _daemon_text(found, running=running, under_systemd=under_systemd, when=when)),
    ]
    current = found if running and found is not None and found.stopped_at is None else None
    if current is not None and (watcher := _watcher_text(current, now, when)) is not None:
        fields.append(("Watcher", watcher))
    print_fields(fields)
    if installed is not None:
        executable = unit.installed_executable(installed)
        if executable is not None and not executable.exists():
            warnings.append(f"the unit runs {executable}, which no longer exists")
        warnings += unit.path_differences(installed, os.environ)
    for warning in warnings:
        typer.echo(f"warning: {warning}", err=True)
    if not running:
        raise typer.Exit(NOT_RUNNING)
