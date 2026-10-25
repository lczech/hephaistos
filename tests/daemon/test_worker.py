import asyncio
import logging
import os
import shutil
import signal
import subprocess
from pathlib import Path

import pytest

from hephaistos.core.observers import clones as observer
from hephaistos.core.utils import logs
from hephaistos.core.utils.errors import DatabaseBusyError
from hephaistos.core.utils.paths import Paths
from hephaistos.daemon.watcher import worker
from hephaistos.daemon.watcher.worker import Done, PassFailed, Worker, WorkerDiedError
from support import git


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


def test_passes_run_at_low_priority_in_its_own_group(paths: Paths, repo: Path) -> None:
    async def passes() -> tuple[int, list[Done | PassFailed]]:
        started = await Worker.started(paths)
        pid = started.pid
        assert pid is not None
        try:
            assert os.getpgid(pid) == pid  # Ctrl+C in a terminal doesn't reach it
            assert os.getpriority(os.PRIO_PROCESS, pid) == worker.NICENESS
            if shutil.which("ionice"):
                shown = subprocess.run(  # noqa: ASYNC221 - a test may wait
                    ["ionice", "-p", str(pid)], check=True, capture_output=True, text=True
                )
                assert shown.stdout.strip() == "best-effort: prio 7"
            first = await started.run_pass()
            git(repo, "commit", "--quiet", "--allow-empty", "--message", "two")
            return pid, [first, await started.run_pass()]
        finally:
            started.stop()

    pid, done = asyncio.run(passes())
    assert done == [Done(0, 1, 0, 1, 0), Done(1, 1, 0, 1, 0)]
    assert not _alive(pid)


@pytest.mark.usefixtures("paths")
def test_a_failed_pass_is_reported(paths: Paths) -> None:
    async def failed() -> Done | PassFailed:
        started = await Worker.started(paths)
        try:
            return await started.run_pass()
        finally:
            started.stop()

    message = "hephaistos is not set up on this machine; run `hephaistos setup`"
    assert asyncio.run(failed()) == PassFailed(message)


@pytest.mark.usefixtures("repo")
def test_a_killed_worker_is_reported(paths: Paths) -> None:
    async def killed() -> None:
        started = await Worker.started(paths)
        assert started.pid is not None
        os.kill(started.pid, signal.SIGKILL)
        try:
            with pytest.raises(WorkerDiedError, match="killed by SIGKILL"):
                await started.run_pass()
        finally:
            started.stop()

    asyncio.run(killed())


def test_a_busy_database_is_retried(paths: Paths, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(worker, "BUSY_RETRY_DELAYS", (0.0, 0.0, 0.0))
    attempts: list[int] = []

    def busy(_: Paths) -> observer.Result:
        attempts.append(1)
        if len(attempts) < 3:
            raise DatabaseBusyError(5)
        return observer.Result([], 2, 0, 3, 1)

    monkeypatch.setattr(observer, "observe", busy)
    assert worker.observed(paths) == Done(0, 2, 3, 1, 0)
    attempts.clear()

    def always_busy(_: Paths) -> observer.Result:
        attempts.append(1)
        raise DatabaseBusyError(5)

    monkeypatch.setattr(observer, "observe", always_busy)
    failed = worker.observed(paths)
    assert len(attempts) == 4
    assert isinstance(failed, PassFailed)
    assert failed.message.startswith("the database stayed busy")


def test_an_unexpected_error_comes_with_its_traceback(
    paths: Paths, monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken(_: Paths) -> observer.Result:
        raise KeyError("x")

    monkeypatch.setattr(observer, "observe", broken)
    failed = worker.observed(paths)
    assert isinstance(failed, PassFailed)
    assert failed.message == "unexpected KeyError: 'x'"
    assert failed.details is not None
    assert "Traceback" in failed.details


@pytest.mark.usefixtures("repo")
def test_logs_as_the_daemon_does(paths: Paths, capfd: pytest.CaptureFixture[str]) -> None:
    async def passed() -> int | None:
        started = await Worker.started(paths)
        try:
            await started.run_pass()
        finally:
            started.stop()
        return started.pid

    logs.start(logs.Setup(paths.state_dir, "daemon", logging.DEBUG, shown=True))
    try:
        pid = asyncio.run(passed())
    finally:
        logs.stop()
    assert f"DEBUG daemon[{pid}] git " in capfd.readouterr().err
