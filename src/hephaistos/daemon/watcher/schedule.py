"""The Watcher: observes this Machine in passes, `watcher.interval` apart, in its worker."""

import asyncio
import logging
import time
from collections.abc import Callable
from datetime import UTC, datetime

from hephaistos.core import config
from hephaistos.core.utils.paths import Paths
from hephaistos.daemon.status import PassStatus
from hephaistos.daemon.watcher.worker import Done, PassFailed, Worker, WorkerDiedError

log = logging.getLogger(__name__)


def _log_pass(outcome: Done | PassFailed, duration: float) -> None:
    """Logs a pass: at info if it recorded Events, at debug if not, as an error if it failed."""
    if isinstance(outcome, PassFailed):
        fields: dict[str, object] = {"duration": duration}
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
    }
    level = logging.INFO if outcome.events else logging.DEBUG
    log.log(level, "pass: %d Events", outcome.events, extra=fields)


class Watcher:
    """Runs a pass at once, then each `watcher.interval` seconds after the last one ended."""

    name = "watcher"

    def __init__(self, paths: Paths, report: Callable[[PassStatus], None]) -> None:
        """Observes with `paths`, reporting each pass to `report`."""
        self._paths = paths
        self._report = report
        self._worker: Worker | None = None

    async def _pass(self) -> Done | PassFailed:
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
        """Runs passes until cancelled; then stops the worker."""
        try:
            while True:
                started = time.monotonic()
                outcome = await self._pass()
                duration = round(time.monotonic() - started, 3)
                _log_pass(outcome, duration)
                error = outcome.message if isinstance(outcome, PassFailed) else None
                self._report(PassStatus(datetime.now(UTC), duration, error))
                await asyncio.sleep(config.settings().watcher.interval)
        finally:
            if self._worker is not None:
                self._worker.stop()
                self._worker = None

    def kill(self) -> None:
        """Kills the worker at once, with any git it runs."""
        if self._worker is not None:
            self._worker.kill()
