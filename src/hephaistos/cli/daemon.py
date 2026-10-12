"""`hephaistos daemon`: the background process that keeps this Machine's State fresh."""

import base64
import os
import sys
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated

import typer

from hephaistos.cli import terminal
from hephaistos.cli.output import (
    JsonOption,
    TimeFormatOption,
    chosen_time_format,
    number_text,
    print_fields,
    print_json,
    short_path,
    time_formatter,
)
from hephaistos.core import config
from hephaistos.core.config import TimeFormat
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.paths import Paths, own_checkout
from hephaistos.daemon import report, unit
from hephaistos.daemon import status as daemon_status
from hephaistos.daemon.errors import NotStartedError
from hephaistos.daemon.report import Report
from hephaistos.daemon.server import ports
from hephaistos.daemon.server import token as server_token
from hephaistos.daemon.status import PassStatus, ServerStatus, Status

NOT_RUNNING = 3  # `status`'s exit code, as systemctl's

VERSE = "RGVtb25zIHJ1biB3aGVuIGEgZ29vZCBtYW4gZ29lcyB0byB3YXIsCk5pZ2h0IHdpbGwgZmFsbCBhbmQgZHJvd24gdGhlIHN1biwKV2hlbiBhIGdvb2QgbWFuIGdvZXMgdG8gd2FyLgoKRnJpZW5kc2hpcCBkaWVzIGFuZCB0cnVlIGxvdmUgbGllcywKTmlnaHQgd2lsbCBmYWxsLCBhbmQgdGhlIGRhcmsgd2lsbCByaXNlLApXaGVuIGEgZ29vZCBtYW4gZ29lcyB0byB3YXIuCgpEZW1vbnMgcnVuLCBidXQgY291bnQgdGhlIGNvc3Q7ClRoZSBiYXR0bGUncyB3b24sIGJ1dCB0aGUgY2hpbGQgaXMgbG9zdC4="  # noqa: E501 - one encoded verse

app = typer.Typer(
    no_args_is_help=True,
    help="The Daemon: observes this Machine and serves its GUIs, in the background.",
)


@app.command()
def run(
    *,
    doctor_who: Annotated[bool, typer.Option("--doctor-who", hidden=True)] = False,
) -> None:
    """Run the Daemon in the foreground, until stopped (Ctrl+C or SIGTERM).

    It runs the parts its settings enable: the Watcher observes this Machine's Clones every
    watcher.interval seconds and when a GUI asks, with git at low priority; the Server gives
    GUIs access, on 127.0.0.1 at server.port. One Daemon runs per Machine.
    """
    if doctor_who:
        typer.echo(base64.b64decode(VERSE).decode())
        return
    try:
        from hephaistos.daemon import main as daemon  # noqa: PLC0415 - only this command needs it
    except ModuleNotFoundError as error:
        if error.name is None or error.name.partition(".")[0] == "hephaistos":
            raise
        raise NotStartedError(
            f"hephaistos is missing the package {error.name}; reinstall it with its dependencies,"
            f" e.g. `{_reinstall_text()}`"
        ) from None
    daemon.run(Paths.from_environment(), lambda text: typer.echo(text, err=True))


def _reinstall_text() -> str:
    """How to reinstall hephaistos: from its checkout, if it runs from one."""
    if (checkout := own_checkout()) is not None:
        return f"uv tool install --reinstall --editable {short_path(checkout)}"
    return "uv tool install --reinstall hephaistos"


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


def _unit_text(found: Report) -> str:
    """The `Unit` line of `status`."""
    state = found.unit
    if state is None:
        return "systemd not available"
    if found.installed is None:
        return "not installed"
    active = state.active
    if active == "failed" and state.exit_code:
        active += f" (exit code {state.exit_code})"
    enabled = "enabled" if state.enabled else "disabled"
    return f"installed, {enabled}, {active}; linger {'on' if found.linger else 'off'}"


def _daemon_text(found: Report, when: Callable[[datetime], str]) -> str:
    """The `Daemon` line of `status`."""
    last = found.status
    if found.running:
        how = "running" if found.under_systemd else "running (not under systemd)"
        current = found.current
        if current is None:
            return how
        started = when(current.started_at)
        return f"{how}, pid {current.pid}, started {started}, version {current.version}"
    if last is None:
        return "not running; never ran"
    if last.stopped_at is not None:
        return f"not running; stopped {when(last.stopped_at)}"
    return f"not running; ended without stopping, last seen {when(last.last_seen_at)}"


def _last_pass_text(done: PassStatus | None, when: Callable[[datetime], str]) -> str:
    """The `Last pass` line of `status`."""
    if done is None:
        return "none yet"
    by = "the Watcher" if done.trigger == "watcher" else "API request"
    text = f"{when(done.finished_at)} ({done.duration:g} s), by {by}"
    return text if done.error is None else f"{text}; failed: {done.error}"


def _watcher_text(current: Status, now: datetime, when: Callable[[datetime], str]) -> str:
    """The `Watcher` line of `status`: its timer."""
    if "watcher" not in current.parts:
        return "passes only on request (watcher.interval is 0)"
    done = current.watcher
    text = f"every {config.settings().watcher.interval:g} s"
    if done is None:
        return f"{text}; first pass running"
    if report.is_stalled(done, now):
        return f"{text}; stalled: last pass {when(done.finished_at)}"
    next_at = report.next_pass_at(done)
    wait = 0 if next_at is None else (next_at - now).total_seconds()
    return f"{text}; next pass in {max(0, round(wait))} s"


def _server_text(server: ServerStatus, when: Callable[[datetime], str]) -> str:
    """The `Server` line of `status`."""
    if server.error is not None:
        return f"failed: {server.error}"
    if not server.listening:
        return "starting"
    text = f"listening on {server.address}; "
    if server.last_request_at is None:
        text += "no requests yet"
    else:
        requests = number_text(server.requests, "request")
        text += f"{requests} since start, last {when(server.last_request_at)}"
    return text + (f"; {server.refused} refused" if server.refused else "")


@app.command()
def status(time_format: TimeFormatOption = None, *, as_json: JsonOption = False) -> None:
    """Show whether the Daemon runs, how it is installed, and how its parts are doing.

    Exits with 0 if it runs, 3 if not.
    """
    paths = Paths.from_environment()
    now = datetime.now(UTC)
    found = report.report(paths, os.environ)
    if as_json:
        print_json(report.report_json(found, now))
    else:
        _print_status(found, now, time_format)
    if not found.running:
        raise typer.Exit(NOT_RUNNING)


def _print_status(found: Report, now: datetime, time_format: TimeFormat | None) -> None:
    """Prints a report as `status` shows it: a line each, warnings on stderr."""
    shown = time_formatter(time_format, TimeFormat.RELATIVE, now)
    relative = chosen_time_format(time_format, TimeFormat.RELATIVE) is TimeFormat.RELATIVE

    def when(at: datetime) -> str:
        text = shown(at)
        if not relative:
            return f"at {text}"
        return text if text == "now" else f"{text} ago"

    fields = [("Unit", _unit_text(found)), ("Daemon", _daemon_text(found, when))]
    current = found.current
    if current is not None:
        fields.append(("Last pass", _last_pass_text(current.watcher, when)))
        fields.append(("Watcher", _watcher_text(current, now, when)))
    if current is not None and current.server is not None:
        fields.append(("Server", _server_text(current.server, when)))
    print_fields(fields)
    for warning in found.warnings:
        typer.echo(f"warning: {warning}", err=True)


@app.command()
def token(
    *,
    url: Annotated[
        bool,
        typer.Option(
            "--url", help="Print a link that gives a browser the token, for the GUI to come."
        ),
    ] = False,
    renew: Annotated[
        bool, typer.Option("--renew", help="Replace it: every client needs the new one.")
    ] = False,
    yes: Annotated[bool, typer.Option("--yes", help="Renew without asking.")] = False,
) -> None:
    """Print the token that clients send to this Machine's Server.

    A client that can log in as you reads it with `ssh <machine> hephaistos daemon token`.
    """
    paths = Paths.from_environment()
    port = _own_server_port(paths) if url else None
    if renew:
        if not yes:
            terminal.confirm(
                "This logs out every client of this Machine's Server. Renew the token?",
                default=False,
                action="renew it",
            )
        value = server_token.renew(paths)
    else:
        value = server_token.token(paths)
    # In the fragment, after `#`, the token never reaches a server; the GUI's page reads it.
    typer.echo(value if port is None else f"http://127.0.0.1:{port}/#token={value}")


def _own_server_port(paths: Paths) -> int:
    """The port our Server listens on; raises unless it runs and the port is the user's."""
    found = (
        daemon_status.read(paths.state_dir) if daemon_status.is_running(paths.state_dir) else None
    )
    server = found.server if found is not None and found.stopped_at is None else None
    if server is None or not server.listening:
        raise HephaistosError("the Server isn't running; see `hephaistos daemon status`")
    if ports.holder(server.port) != os.getuid():
        raise HephaistosError(f"port {server.port} isn't your Server's; not giving out the token")
    return server.port
