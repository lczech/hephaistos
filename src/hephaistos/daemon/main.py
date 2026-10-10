"""The Daemon: runs this Machine's enabled parts until stopped, restarting any that crash.

The first SIGINT or SIGTERM stops it at once: a pass cut short loses nothing, as git only reads
and SQLite rolls back what wasn't committed. A second one, while it stops, exits immediately.
"""

import asyncio
import dataclasses
import logging
import os
import signal
import time
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol

from hephaistos import __version__
from hephaistos.core import config
from hephaistos.core.db.sessions import read_session
from hephaistos.core.utils import git
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.paths import Paths
from hephaistos.daemon import status
from hephaistos.daemon.errors import NotStartedError
from hephaistos.daemon.status import PassStatus, Status
from hephaistos.daemon.watcher.schedule import Watcher

FIRST_RESTART_DELAY = 1.0  # seconds before restarting a crashed part; doubles with each crash
LAST_RESTART_DELAY = 60.0
STEADY_TIME = 600.0  # seconds a part runs without crashing to count as recovered
STOP_SIGNALS = (signal.SIGINT, signal.SIGTERM)
SOURCE = Path(__file__).parents[3]  # the checkout, when running from one: `src/hephaistos/…`

log = logging.getLogger(__name__)


class Part(Protocol):
    """A part of the Daemon, e.g. the Watcher."""

    name: str

    async def run(self) -> None:
        """Does the part's work until cancelled."""
        ...

    def kill(self) -> None:
        """Kills the processes it started, at once."""
        ...


def running_version(source: Path = SOURCE) -> str:
    """Our version, with the commit it runs from a checkout, e.g. `0.1.0 (bfc66f6-dirty)`."""
    if not (source / ".git").exists() or not (source / "src" / "hephaistos").is_dir():
        return __version__
    described = git.describe(source)
    return __version__ if described is None else f"{__version__} ({described})"


def _enabled(settings: config.Settings) -> list[str]:
    """The names of the parts that the settings enable."""
    return [name for name, enabled in ((Watcher.name, settings.watcher.enabled),) if enabled]


def _checked(paths: Paths) -> tuple[list[str], git.Installation]:
    """The parts to run and the git to run; raises NotStartedError if the Daemon can't start."""
    names = _enabled(config.settings())
    if not names:
        raise NotStartedError("no Daemon parts are enabled: watcher.enabled is false")
    try:
        found = git.installation()
        with read_session(paths):
            pass
    except HephaistosError as error:
        raise NotStartedError(str(error)) from None
    return names, found


async def keep_running(part: Part) -> None:
    """Runs a part, restarting it after a crash; ever later, until it runs steadily."""
    delay = FIRST_RESTART_DELAY
    while True:
        started = time.monotonic()
        try:
            await part.run()
            log.error("%s ended unexpectedly", part.name)
        except Exception:
            log.exception("%s crashed", part.name)
        if time.monotonic() - started >= STEADY_TIME:
            delay = FIRST_RESTART_DELAY
        log.info("restarting %s in %g s", part.name, delay)
        await asyncio.sleep(delay)
        delay = min(delay * 2, LAST_RESTART_DELAY)


class Daemon:
    """The running Daemon: its parts, and the status file they report to."""

    def __init__(self, paths: Paths, names: list[str], version: str) -> None:
        """Prepares the parts named; `run` starts them."""
        self._paths = paths
        self._status = Status(os.getpid(), version, datetime.now(UTC), parts=dict.fromkeys(names))
        builders: dict[str, Callable[[], Part]] = {
            Watcher.name: lambda: Watcher(paths, self._reporter(Watcher.name)),
        }
        self._parts = [builders[name]() for name in names]
        self._stopping = asyncio.Event()
        self._reason = ""

    def _reporter(self, name: str) -> Callable[[PassStatus], None]:
        """Records a part's passes in the status file."""

        def report(done: PassStatus) -> None:
            parts = {**self._status.parts, name: done}
            self._save(dataclasses.replace(self._status, parts=parts))

        return report

    def _save(self, new: Status) -> None:
        """Keeps the status, and writes it to the status file."""
        self._status = new
        try:
            status.write(self._paths.state_dir, new)
        except OSError as error:
            log.warning("cannot write the status file: %s", error)

    def _on_signal(self, number: signal.Signals) -> None:
        """Stops at the first signal; exits at once at the second."""
        if self._stopping.is_set():
            log.warning("%s while stopping: exiting at once", number.name)
            for part in self._parts:
                part.kill()
            os._exit(128 + number)
        self._reason = number.name
        self._stopping.set()

    async def _supervise(self) -> None:
        """Runs the parts until a signal stops them."""
        loop = asyncio.get_running_loop()
        for number in STOP_SIGNALS:
            loop.add_signal_handler(number, self._on_signal, number)
        tasks = [asyncio.create_task(keep_running(part)) for part in self._parts]
        try:
            await self._stopping.wait()
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            for number in STOP_SIGNALS:
                loop.remove_signal_handler(number)

    def run(self) -> str:
        """Runs the parts until a signal stops them; returns the signal's name."""
        self._save(self._status)
        try:
            asyncio.run(self._supervise())
        finally:
            self._save(dataclasses.replace(self._status, stopped_at=datetime.now(UTC)))
        return self._reason


def run(paths: Paths, announce: Callable[[str], None]) -> None:
    """Runs the Daemon with the active settings until stopped; `announce` tells what runs.

    Raises NotStartedError if it can't start, e.g. as another Daemon runs.
    """
    names, found = _checked(paths)
    with status.held_lock(paths.state_dir):
        previous = status.read(paths.state_dir)
        if previous is not None and previous.stopped_at is None:
            log.warning("the previous Daemon (pid %d) ended without stopping", previous.pid)
        version = running_version()
        daemon = Daemon(paths, names, version)
        log.info(
            "running: %s",
            ", ".join(names),
            extra={
                "version": version,
                "interval": config.settings().watcher.interval,
                "git": found.executable,
                "git_version": found.version,
            },
        )
        announce(f"Running: {', '.join(names)}; Ctrl+C stops the Daemon")
        reason = daemon.run()
        log.info("stopped: %s", reason)
