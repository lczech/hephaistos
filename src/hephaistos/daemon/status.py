"""The Daemon's lock, held while it runs, and its status file, saying how its parts are doing.

The kernel releases the lock when the process ends, however it ends, so whoever can take the
lock knows that no Daemon runs. The status file is replaced as a whole, never half written.
"""

import fcntl
import json
import os
import time
from collections.abc import Generator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from hephaistos.daemon.errors import NotStartedError

LOCK_NAME = "daemon.lock"
LOCK_WAIT = 1.0  # seconds a starting Daemon waits for the lock, which `is_running` takes briefly
LOCK_RETRY = 0.05  # seconds between attempts
STATUS_NAME = "daemon.json"


@dataclass(frozen=True)
class PassStatus:
    """How a part's last pass went."""

    finished_at: datetime
    duration: float  # seconds
    error: str | None = None


@dataclass(frozen=True)
class Status:
    """What a Daemon says about itself; `stopped_at` is None while it runs, or if it crashed."""

    pid: int
    version: str
    started_at: datetime
    stopped_at: datetime | None = None
    # The enabled parts' last passes; None before the first.
    parts: Mapping[str, PassStatus | None] = field(default_factory=dict[str, PassStatus | None])


def _status_json(status: Status) -> dict[str, object]:
    """A status as JSON values."""

    def at(value: datetime | None) -> str | None:
        return None if value is None else value.isoformat()

    return {
        "pid": status.pid,
        "version": status.version,
        "started_at": at(status.started_at),
        "stopped_at": at(status.stopped_at),
        "parts": {
            name: None
            if done is None
            else {
                "finished_at": at(done.finished_at),
                "duration": done.duration,
                "error": done.error,
            }
            for name, done in status.parts.items()
        },
    }


def _status_from(data: Any) -> Status:  # noqa: ANN401 - JSON, checked by using it
    """A status from its JSON values; raises if any don't fit."""

    def at(value: Any) -> datetime | None:  # noqa: ANN401
        return None if value is None else datetime.fromisoformat(value)

    passes = {
        str(name): None
        if done is None
        else PassStatus(
            datetime.fromisoformat(done["finished_at"]),
            float(done["duration"]),
            None if done["error"] is None else str(done["error"]),
        )
        for name, done in data["parts"].items()
    }
    started = datetime.fromisoformat(data["started_at"])
    return Status(int(data["pid"]), str(data["version"]), started, at(data["stopped_at"]), passes)


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
    directory.mkdir(parents=True, exist_ok=True)
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
