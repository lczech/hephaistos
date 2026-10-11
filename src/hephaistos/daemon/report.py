"""How the Daemon is doing: what `daemon status` shows and `/api/daemon` returns."""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import TypedDict

from hephaistos.core import config
from hephaistos.core.utils.paths import Paths
from hephaistos.daemon import status, unit
from hephaistos.daemon.status import PassStatus, ServerStatus, Status
from hephaistos.daemon.unit import ForeignUnitError, UnitState

STALLED_PASSES = 3  # intervals, plus git.timeout, after which a pass is overdue


@dataclass(frozen=True)
class Report:
    """The Daemon's unit, lock and status file, as found now."""

    unit: UnitState | None  # None if systemd isn't available
    installed: str | None  # our unit's text, if installed
    linger: bool
    running: bool
    status: Status | None  # of the running Daemon, else of the last one
    warnings: tuple[str, ...]

    @property
    def under_systemd(self) -> bool:
        """Whether systemd runs the Daemon."""
        return self.unit is not None and self.unit.active == "active"

    @property
    def current(self) -> Status | None:
        """The running Daemon's status; None if none runs, or it says nothing yet."""
        found = self.status
        return found if self.running and found is not None and found.stopped_at is None else None


def report(paths: Paths, env: Mapping[str, str]) -> Report:
    """How the Daemon is doing; `env` is the shell's, compared with the unit's."""
    state = unit.unit_state()
    warnings: list[str] = []
    try:
        installed = unit.installed_text()
    except ForeignUnitError as error:
        installed = None
        warnings.append(str(error))
    if installed is not None:
        executable = unit.installed_executable(installed)
        if executable is not None and not executable.exists():
            warnings.append(f"the unit runs {executable}, which no longer exists")
        warnings += unit.path_differences(installed, env)
    return Report(
        unit=state,
        installed=installed if state is None or state.installed else None,
        linger=unit.has_linger(),
        running=status.is_running(paths.state_dir),
        status=status.read(paths.state_dir),
        warnings=tuple(warnings),
    )


def is_stalled(done: PassStatus, now: datetime) -> bool:
    """Whether the Watcher's next pass is overdue, so it seems stuck."""
    settings = config.settings()
    overdue = STALLED_PASSES * settings.watcher.interval + settings.git.timeout
    return (now - done.finished_at).total_seconds() > overdue


def next_pass_at(done: PassStatus) -> datetime:
    """When the Watcher's next pass starts."""
    return done.finished_at + timedelta(seconds=config.settings().watcher.interval)


class UnitJson(TypedDict):
    """The Daemon's systemd unit."""

    installed: bool
    enabled: bool
    active: str  # `active`, `inactive`, `failed`, …
    exit_code: int | None  # of its last run, if it ended
    linger: bool


class ProcessJson(TypedDict):
    """The running Daemon, or else the last one."""

    running: bool
    under_systemd: bool
    pid: int | None
    version: str | None
    started_at: str | None
    stopped_at: str | None
    last_seen_at: str | None
    ended_without_stopping: bool


class PassJson(TypedDict):
    """The Watcher's last pass."""

    finished_at: str
    duration: float  # seconds
    error: str | None


class WatcherJson(TypedDict):
    """The Watcher of the running Daemon."""

    interval: float  # seconds
    last_pass: PassJson | None
    next_pass_at: str | None
    stalled: bool


class ServerJson(TypedDict):
    """The Server of the running Daemon; counts since the Daemon started."""

    address: str
    listening: bool
    error: str | None
    requests: int
    last_request_at: str | None
    refused: int


class DaemonJson(TypedDict):
    """How the Daemon is doing; its parts only while it runs, and only those enabled."""

    unit: UnitJson | None  # None if systemd isn't available
    daemon: ProcessJson
    watcher: WatcherJson | None
    server: ServerJson | None
    warnings: list[str]


def _at(value: datetime | None) -> str | None:
    """A time as JSON."""
    return None if value is None else value.isoformat()


def _watcher_json(done: PassStatus | None, now: datetime) -> WatcherJson:
    """The Watcher, from its last pass."""
    if done is None:
        return WatcherJson(
            interval=config.settings().watcher.interval,
            last_pass=None,
            next_pass_at=None,
            stalled=False,
        )
    stalled = is_stalled(done, now)
    return WatcherJson(
        interval=config.settings().watcher.interval,
        last_pass=PassJson(
            finished_at=done.finished_at.isoformat(), duration=done.duration, error=done.error
        ),
        next_pass_at=None if stalled else next_pass_at(done).isoformat(),
        stalled=stalled,
    )


def _server_json(server: ServerStatus) -> ServerJson:
    """The Server, as it reported last."""
    return ServerJson(
        address=server.address,
        listening=server.listening,
        error=server.error,
        requests=server.requests,
        last_request_at=_at(server.last_request_at),
        refused=server.refused,
    )


def report_json(found: Report, now: datetime) -> DaemonJson:
    """A report as JSON."""
    state, last, current = found.unit, found.status, found.current
    return DaemonJson(
        unit=None
        if state is None
        else UnitJson(
            installed=found.installed is not None,
            enabled=state.enabled,
            active=state.active,
            exit_code=state.exit_code,
            linger=found.linger,
        ),
        daemon=ProcessJson(
            running=found.running,
            under_systemd=found.under_systemd,
            pid=None if last is None else last.pid,
            version=None if last is None else last.version,
            started_at=None if last is None else _at(last.started_at),
            stopped_at=None if last is None else _at(last.stopped_at),
            last_seen_at=None if last is None else _at(last.last_seen_at),
            ended_without_stopping=not found.running
            and last is not None
            and last.stopped_at is None,
        ),
        watcher=_watcher_json(current.watcher, now)
        if current is not None and "watcher" in current.parts
        else None,
        server=None if current is None or current.server is None else _server_json(current.server),
        warnings=list(found.warnings),
    )
