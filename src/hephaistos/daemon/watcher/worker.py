"""The Watcher's worker: a process at low priority that runs the passes, and so git.

It lowers its own CPU and I/O priority once, before starting any thread, so that its threads and
every git they run inherit it at no further cost. It leads its own process group: a terminal's
Ctrl+C doesn't reach it, and the Daemon stops it together with any git it runs.
"""

import asyncio
import contextlib
import logging
import multiprocessing
import os
import signal
import subprocess
import time
import traceback
from dataclasses import dataclass
from multiprocessing.connection import Connection
from multiprocessing.process import BaseProcess

from hephaistos.core import config
from hephaistos.core.observers import clones as observer
from hephaistos.core.utils import logs
from hephaistos.core.utils.errors import DatabaseBusyError, HephaistosError
from hephaistos.core.utils.paths import Paths

NICENESS = 19  # the lowest CPU priority
STOP_WAIT = 1.0  # seconds a worker gets to end before it is killed
BUSY_RETRY_DELAYS = (1.0, 2.0, 4.0)  # seconds before each retry of a pass on a busy database
_READY = "ready"  # the worker to the Daemon, once
_OBSERVE = "observe"  # the Daemon to the worker, for each pass

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Done:
    """What a pass observed."""

    events: int  # recorded
    observed: int  # Clones
    worktrees: int
    updated: int  # Checkouts whose State changed
    skipped: int  # Clones observed by another process meanwhile


@dataclass(frozen=True)
class PassFailed:
    """Why a pass failed."""

    message: str
    details: str | None = None  # the traceback of an unexpected error


class WorkerDiedError(Exception):
    """The worker ended while it was needed; the message says how."""


def _lower_priority() -> None:
    """Lowers this process's CPU and I/O priority, for the threads and processes it starts."""
    os.setpriority(os.PRIO_PROCESS, 0, NICENESS)
    try:
        subprocess.run(  # noqa: S603 - arguments are a list, never passed through a shell
            ["ionice", "-c3", "-p", str(os.getpid())],  # noqa: S607 - from the PATH, like git
            check=True,
            capture_output=True,
            timeout=config.settings().git.timeout,
        )
    except (OSError, subprocess.SubprocessError) as error:
        log.warning("git runs at normal I/O priority: ionice failed: %s", error)


def observed(paths: Paths) -> Done | PassFailed:
    """Observes this Machine's Clones, retrying while the database is busy."""
    for delay in (*BUSY_RETRY_DELAYS, None):
        try:
            result = observer.observe(paths)
        except DatabaseBusyError as error:
            if delay is None:
                return PassFailed(str(error))
            log.warning("the database is busy; retrying in %g s", delay)
            time.sleep(delay)
        except HephaistosError as error:
            return PassFailed(str(error))
        except Exception as error:  # noqa: BLE001 - reported to the Watcher, which logs it
            message = f"unexpected {type(error).__name__}: {error}"
            return PassFailed(message, traceback.format_exc())
        else:
            return Done(
                len(result.events),
                result.observed,
                result.worktrees,
                result.updated,
                result.skipped,
            )
    raise AssertionError  # the last delay is None


def _serve(
    connection: Connection, paths: Paths, settings: config.Settings, logged: logs.Setup | None
) -> None:
    """The worker process: runs a pass for each request, until the Daemon closes the pipe."""
    os.setpgid(0, 0)
    config.activate(settings)
    if logged is not None:
        logs.start(logged)
    _lower_priority()
    connection.send(_READY)
    while True:
        try:
            connection.recv()
        except EOFError:
            return
        connection.send(observed(paths))


class Worker:
    """The Daemon's handle on a worker process."""

    def __init__(self, process: BaseProcess, connection: Connection) -> None:
        """Wraps a started worker; see `started`."""
        self._process = process
        self._connection = connection

    @classmethod
    async def started(cls, paths: Paths) -> "Worker":
        """A new worker, with the active settings, logging as the Daemon does, ready for passes."""
        context = multiprocessing.get_context("spawn")  # forking a process with threads isn't safe
        ours, theirs = context.Pipe()
        process = context.Process(
            target=_serve,
            args=(theirs, paths, config.settings(), logs.active()),
            name="hephaistos watcher",
            daemon=True,
        )
        process.start()
        theirs.close()
        worker = cls(process, ours)
        try:
            await worker._received()  # _READY
        except BaseException:
            worker.stop()
            raise
        return worker

    @property
    def pid(self) -> int | None:
        """The worker's process ID."""
        return self._process.pid

    async def run_pass(self) -> Done | PassFailed:
        """Has the worker run a pass; raises WorkerDiedError if it ends meanwhile."""
        try:
            self._connection.send(_OBSERVE)
        except OSError:
            raise WorkerDiedError(self._ending()) from None
        reply = await self._received()
        if not isinstance(reply, Done | PassFailed):
            raise TypeError(reply)
        return reply

    async def _received(self) -> object:
        """The worker's next reply, waited for without blocking the Daemon."""
        loop = asyncio.get_running_loop()
        readable = loop.create_future()
        descriptor = self._connection.fileno()
        loop.add_reader(descriptor, lambda: readable.done() or readable.set_result(None))
        try:
            await readable
        finally:
            loop.remove_reader(descriptor)
        try:
            return self._connection.recv()
        except (EOFError, OSError):
            raise WorkerDiedError(self._ending()) from None

    def _ending(self) -> str:
        """How the worker ended, once it has."""
        self._process.join(STOP_WAIT)
        code = self._process.exitcode
        if code is None:
            return "it stopped answering"
        if code < 0:
            return f"killed by {signal.Signals(-code).name}"
        return f"exit code {code}"

    def _signal_group(self, number: signal.Signals) -> None:
        """Sends a signal to the worker and the processes it started, or just to it."""
        if self._process.exitcode is not None or self._process.pid is None:
            return
        try:
            os.killpg(self._process.pid, number)
        except (ProcessLookupError, PermissionError):  # not leading its group yet
            with contextlib.suppress(ProcessLookupError):
                os.kill(self._process.pid, number)

    def stop(self) -> None:
        """Ends the worker and any git it runs, killing them if they don't end in time."""
        self._signal_group(signal.SIGTERM)
        self._process.join(STOP_WAIT)
        if self._process.exitcode is None:
            self.kill()
        self._connection.close()

    def kill(self) -> None:
        """Kills the worker and any git it runs, at once."""
        self._signal_group(signal.SIGKILL)
        self._process.join(STOP_WAIT)
