"""The Watcher: observes this Machine in passes, in its worker, on its timer and on request.

Passes never overlap. A request waits for a pass that starts after it arrives, so that the pass
sees what the user just did; requests arriving during a pass share the one after it. The timer
asks for a pass `watcher.interval` seconds after the last one ended, whatever asked for that.
"""

import asyncio
import contextlib
import logging
import time
from collections.abc import Callable
from datetime import UTC, datetime

from hephaistos.core import config
from hephaistos.core.utils.paths import Paths
from hephaistos.daemon.status import PassStatus, Trigger
from hephaistos.daemon.watcher.worker import Done, PassFailed, Worker, WorkerDiedError

log = logging.getLogger(__name__)


def _log_pass(outcome: Done | PassFailed, duration: float, trigger: Trigger) -> None:
    """Logs a pass: at info if it recorded Events, at debug if not, as an error if it failed."""
    if isinstance(outcome, PassFailed):
        fields: dict[str, object] = {"duration": duration, "trigger": trigger}
        if outcome.details is not None:
            fields["error"] = outcome.details
        log.error("pass failed: %s", outcome.message, extra=fields)
        return
    fields = {
        "observed": outcome.observed,
        "worktrees": outcome.worktrees,
        "updated": outcome.updated,
        "skipped": outcome.skipped,
        "duration": duration,
        "trigger": trigger,
    }
    level = logging.INFO if outcome.events else logging.DEBUG
    log.log(level, "pass: %d Events", outcome.events, extra=fields)


class Watcher:
    """Runs passes when asked; as a part of the Daemon, its timer asks every interval."""

    name = "watcher"

    def __init__(self, paths: Paths, report: Callable[[PassStatus], None]) -> None:
        """Observes with `paths`, reporting each pass to `report`."""
        self._paths = paths
        self._report = report
        self._worker: Worker | None = None
        self._turn = asyncio.Lock()  # held by the pass running
        self._next: asyncio.Task[Done | PassFailed] | None = None  # waiting for its turn
        self._passes: set[asyncio.Task[Done | PassFailed]] = set()
        self._passed = asyncio.Event()  # set as each pass ends
        self._last_ended: float | None = None  # monotonic

    async def observe(self, trigger: Trigger) -> Done | PassFailed:
        """The outcome of a pass that starts after this call; one waiting already is shared."""
        if self._next is None:
            self._next = asyncio.create_task(self._pass(trigger))
            self._passes.add(self._next)
            self._next.add_done_callback(self._passes.discard)
        return await asyncio.shield(self._next)

    async def _pass(self, trigger: Trigger) -> Done | PassFailed:
        """Runs a pass once the one running ended, reporting it."""
        async with self._turn:
            self._next = None  # requests from now on need the pass after this one
            started = time.monotonic()
            try:
                outcome = await self._worker_pass()
            finally:
                self._last_ended = time.monotonic()
                self._passed.set()
            duration = round(self._last_ended - started, 3)
            _log_pass(outcome, duration, trigger)
            error = outcome.message if isinstance(outcome, PassFailed) else None
            self._report(PassStatus(datetime.now(UTC), duration, error, trigger))
            return outcome

    async def _worker_pass(self) -> Done | PassFailed:
        """Has the worker run a pass, starting a worker first if there is none."""
        if self._worker is None:
            self._worker = await Worker.started(self._paths)
        try:
            return await self._worker.run_pass()
        except WorkerDiedError as error:
            self._worker.stop()
            self._worker = None
            return PassFailed(f"the worker died: {error}")

    async def run(self) -> None:
        """The timer: asks for a pass now, then each `watcher.interval` after the last ended.

        Runs until cancelled.
        """
        while True:
            self._passed.clear()
            wait = None  # until the running pass ends
            if not self._turn.locked():
                interval = config.settings().watcher.interval
                ended = self._last_ended
                wait = 0.0 if ended is None else ended + interval - time.monotonic()
                if wait <= 0:
                    await self.observe("watcher")
                    continue
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._passed.wait(), wait)

    async def stop(self) -> None:
        """Cancels the passes running or waiting, and ends the worker."""
        for task in list(self._passes):
            task.cancel()
        await asyncio.gather(*self._passes, return_exceptions=True)
        if self._worker is not None:
            self._worker.stop()
            self._worker = None

    def kill(self) -> None:
        """Kills the worker at once, with any git it runs."""
        if self._worker is not None:
            self._worker.kill()
