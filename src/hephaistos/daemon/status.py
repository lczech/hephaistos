"""The Daemon's lock, held while it runs, and its status file, saying how its parts are doing.

The kernel releases the lock when the process ends, however it ends, so whoever can take the
lock knows that no Daemon runs. The status file is replaced as a whole, never half written.
"""

import fcntl
import json
import os
import time
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from hephaistos.core.utils.paths import private_directory
from hephaistos.daemon.errors import NotStartedError

LOCK_NAME = "daemon.lock"
LOCK_WAIT = 1.0  # seconds a starting Daemon waits for the lock, which `is_running` takes briefly
LOCK_RETRY = 0.05  # seconds between attempts
STATUS_NAME = "daemon.json"


@dataclass(frozen=True)
class PassStatus:
    """How the Watcher's last pass went."""

    finished_at: datetime
    duration: float  # seconds
    error: str | None = None


@dataclass(frozen=True)
class ServerStatus:
    """How the Server is doing; its counts are since the Daemon started."""

    address: str  # e.g. `127.0.0.1:8264`
    listening: bool
    error: str | None = None  # why it doesn't listen
    requests: int = 0  # answered, with the token
    last_request_at: datetime | None = None
    refused: int = 0  # for a wrong or missing token, or a foreign host

    @property
    def port(self) -> int:
        """The port it listens on, or tries to."""
        return int(self.address.rpartition(":")[2])


@dataclass(frozen=True)
class Status:
    """What a Daemon says about itself; `stopped_at` is None while it runs, or if it crashed."""

    pid: int
    version: str
    started_at: datetime
    stopped_at: datetime | None = None
    parts: tuple[str, ...] = ()  # those enabled
    watcher: PassStatus | None = None  # its last pass
    server: ServerStatus | None = None

    @property
    def last_seen_at(self) -> datetime:
        """When it last showed signs of life."""
        signs = [self.started_at]
        if self.watcher is not None:
            signs.append(self.watcher.finished_at)
        if self.server is not None and self.server.last_request_at is not None:
            signs.append(self.server.last_request_at)
        return max(signs)


def _at(value: datetime | None) -> str | None:
    """A time as JSON."""
    return None if value is None else value.isoformat()


def _from_at(value: Any) -> datetime | None:  # noqa: ANN401 - JSON, checked by using it
    """A time from JSON."""
    return None if value is None else datetime.fromisoformat(value)


def _status_json(status: Status) -> dict[str, object]:
    """A status as JSON values."""
    passed, server = status.watcher, status.server
    return {
        "pid": status.pid,
        "version": status.version,
        "started_at": _at(status.started_at),
        "stopped_at": _at(status.stopped_at),
        "parts": list(status.parts),
        "watcher": None
        if passed is None
        else {
            "finished_at": _at(passed.finished_at),
            "duration": passed.duration,
            "error": passed.error,
        },
        "server": None
        if server is None
        else {
            "address": server.address,
            "listening": server.listening,
            "error": server.error,
            "requests": server.requests,
            "last_request_at": _at(server.last_request_at),
            "refused": server.refused,
        },
    }


def _status_from(data: Any) -> Status:  # noqa: ANN401 - JSON, checked by using it
    """A status from its JSON values; raises if any don't fit."""
    passed, server = data["watcher"], data["server"]
    return Status(
        pid=int(data["pid"]),
        version=str(data["version"]),
        started_at=datetime.fromisoformat(data["started_at"]),
        stopped_at=_from_at(data["stopped_at"]),
        parts=tuple(str(name) for name in data["parts"]),
        watcher=None
        if passed is None
        else PassStatus(
            datetime.fromisoformat(passed["finished_at"]),
            float(passed["duration"]),
            None if passed["error"] is None else str(passed["error"]),
        ),
        server=None
        if server is None
        else ServerStatus(
            address=str(server["address"]),
            listening=bool(server["listening"]),
            error=None if server["error"] is None else str(server["error"]),
            requests=int(server["requests"]),
            last_request_at=_from_at(server["last_request_at"]),
            refused=int(server["refused"]),
        ),
    )


def write(directory: Path, status: Status) -> None:
    """Replaces the status file in `directory` as a whole."""
    path = directory / STATUS_NAME
    written = path.with_name(f"{path.name}.new")
    written.write_text(json.dumps(_status_json(status), indent=2) + "\n")
    written.replace(path)


def read(directory: Path) -> Status | None:
    """The status file in `directory`; None if there is none, or it can't be read."""
    try:
        return _status_from(json.loads((directory / STATUS_NAME).read_text()))
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return None


def _locked(descriptor: int, operation: int) -> bool:
    """Whether `flock` got the lock, waiting LOCK_WAIT at most, e.g. while `is_running` looks."""
    deadline = time.monotonic() + LOCK_WAIT
    while True:
        try:
            fcntl.flock(descriptor, operation | fcntl.LOCK_NB)
        except BlockingIOError:
            if time.monotonic() >= deadline:
                return False
            time.sleep(LOCK_RETRY)
        else:
            return True


@contextmanager
def held_lock(directory: Path) -> Generator[None]:
    """Holds the Daemon's lock in `directory`; raises NotStartedError if another Daemon has it."""
    private_directory(directory)
    descriptor = os.open(directory / LOCK_NAME, os.O_RDWR | os.O_CREAT, 0o644)
    try:
        if not _locked(descriptor, fcntl.LOCK_EX):
            running = read(directory)
            pid = f" (pid {running.pid})" if running else ""
            raise NotStartedError(f"a Daemon is already running on this Machine{pid}")
        yield
    finally:
        os.close(descriptor)  # releases the lock


def is_running(directory: Path) -> bool:
    """Whether a Daemon holds the lock in `directory`."""
    try:
        descriptor = os.open(directory / LOCK_NAME, os.O_RDONLY)
    except FileNotFoundError:
        return False
    try:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_SH | fcntl.LOCK_NB)  # released by closing
        except BlockingIOError:
            return True
        return False
    finally:
        os.close(descriptor)
