"""The Daemon: runs this Machine's enabled parts until stopped, restarting any that crash.

The first SIGINT or SIGTERM stops it at once: a pass cut short loses nothing, as git only reads
and SQLite rolls back what was not committed; then the parts end, the Server answering what is
open. A second signal, while it stops, exits immediately.
"""

import asyncio
import dataclasses
import logging
import os
import signal
import time
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from typing import Protocol

from hephaistos.core import config, serialize
from hephaistos.core.db.sessions import read_session
from hephaistos.core.registry import machines
from hephaistos.core.utils import git
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.paths import Paths
from hephaistos.daemon import checks, status
from hephaistos.daemon.about import running_version
from hephaistos.daemon.errors import NotStartedError, PartError
from hephaistos.daemon.server.server import Server, address
from hephaistos.daemon.status import Check, Checked, PassStatus, ServerStatus, Status
from hephaistos.daemon.watcher.watcher import Watcher

FIRST_RESTART_DELAY = 1.0  # seconds before restarting a crashed part; doubles with each crash
LAST_RESTART_DELAY = 60.0
STEADY_TIME = 600.0  # seconds a part runs without crashing to count as recovered
STOP_SIGNALS = (signal.SIGINT, signal.SIGTERM)

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


def log_checks(found: Sequence[Check]) -> None:
    """Logs checks: problems as warnings, the others as info."""
    for check in found:
        level = logging.WARNING if check.outcome == "problem" else logging.INFO
        fix = "" if check.fix is None else f"; {check.fix}"
        log.log(level, "setup: %s %s: %s%s", check.name, check.outcome, check.text, fix)


def _enabled(settings: config.Settings) -> list[str]:
    """The names of the parts that the settings enable: the Watcher's timer, the Server."""
    parts = ((Watcher.name, settings.watcher.interval > 0), (Server.name, settings.server.enabled))
    return [name for name, enabled in parts if enabled]


def _checked(paths: Paths) -> tuple[list[str], git.Installation]:
    """The parts to run and the git to run; raises NotStartedError if the Daemon cannot start."""
    names = _enabled(config.settings())
    if not names:
        raise NotStartedError("nothing to do: watcher.interval is 0 and server.enabled is false")
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
        except PartError as error:
            log.error("%s failed: %s", part.name, error)  # noqa: TRY400 - its message says it all
        except Exception:
            log.exception("%s crashed", part.name)
        if time.monotonic() - started >= STEADY_TIME:
            delay = FIRST_RESTART_DELAY
        log.info("restarting %s in %g s", part.name, delay)
        await asyncio.sleep(delay)
        delay = min(delay * 2, LAST_RESTART_DELAY)


class Daemon:
    """The running Daemon: its parts, and the status file they report to.

    The Watcher observes on request even while its timer, the part, does not run.
    """

    def __init__(
        self, paths: Paths, names: list[str], version: str, found: Sequence[Check]
    ) -> None:
        """Prepares the parts named, with the checks `found` at the start; `run` starts them."""
        self._paths = paths
        self._watcher = Watcher(paths, self._on_pass)
        port = config.settings().server.port
        self._status = Status(
            os.getpid(),
            version,
            datetime.now(UTC),
            parts=tuple(names),
            server=ServerStatus(address(port), listening=False) if Server.name in names else None,
            checks=Checked(datetime.now(UTC), tuple(found)),
            paths=serialize.hephaistos_paths_json(paths),
        )
        builders: dict[str, Callable[[], Part]] = {
            Watcher.name: lambda: self._watcher,
            Server.name: lambda: Server(
                paths, version, self._on_server, self._watcher.observe, self._on_checks
            ),
        }
        self._parts = [builders[name]() for name in names]
        self._stopping = asyncio.Event()
        self._reason = ""

    def _on_pass(self, done: PassStatus) -> None:
        """Records the Watcher's pass in the status file."""
        self._save(dataclasses.replace(self._status, watcher=done))

    def _on_server(self, now: ServerStatus) -> None:
        """Records how the Server is doing in the status file."""
        self._save(dataclasses.replace(self._status, server=now))

    def _on_checks(self, found: Sequence[Check]) -> None:
        """Records the checks the Server ran, logging what changed since the last ones."""
        before = () if self._status.checks is None else self._status.checks.checks
        log_checks(checks.changed(before, found))
        self._save(
            dataclasses.replace(self._status, checks=Checked(datetime.now(UTC), tuple(found)))
        )

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
            self._watcher.kill()
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
            await self._watcher.stop()  # first, so that no request waits for a pass
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

    Raises NotStartedError if it cannot start, e.g. as another Daemon runs.
    """
    names, found = _checked(paths)
    with status.held_lock(paths.state_dir):
        previous = status.read(paths.state_dir)
        if previous is not None and previous.stopped_at is None:
            log.warning("the previous daemon (pid %d) ended without stopping", previous.pid)
        try:
            machines.update(paths)
        except HephaistosError as error:
            log.warning("cannot update this machine: %s", error)
        version = running_version()
        found_checks = checks.run()
        daemon = Daemon(paths, names, version, found_checks)
        log.info(
            "running: %s",
            ", ".join(names),
            extra={
                "version": version,
                "interval": config.settings().watcher.interval,
                "port": config.settings().server.port,
                "git": found.executable,
                "git_version": found.version,
            },
        )
        log_checks(found_checks)
        announce(f"Running: {', '.join(names)}; Ctrl+C stops the daemon")
        reason = daemon.run()
        log.info("stopped: %s", reason)
