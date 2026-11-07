import asyncio
import logging
import os
import shutil
import signal
import subprocess
import time
from pathlib import Path

import pytest

from hephaistos.core.observers import clones as observer
from hephaistos.core.observers import terminals
from hephaistos.core.utils import logs
from hephaistos.core.utils.errors import DatabaseBusyError
from hephaistos.core.utils.paths import Paths
from hephaistos.daemon.watcher import worker
from hephaistos.daemon.watcher.worker import Done, PassFailed, Worker, WorkerDiedError
from support import SlowGit, git


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
            assert os.getpgid(pid) == pid  # Ctrl+C in a Terminal emulator does not reach it
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


def _gone(pid: int) -> bool:
    """Whether `pid` ended and was reaped, within a few seconds: init reaps an orphan soon."""
    for _ in range(100):
        try:
            state = Path(f"/proc/{pid}/stat").read_text().rpartition(")")[2].split()[0]
        except FileNotFoundError:
            return True
        if state == "Z" and not _alive(pid):
            return True
        time.sleep(0.05)
    return False


@pytest.mark.usefixtures("repo")
def test_stopping_ends_the_git_a_pass_runs(paths: Paths, slow_git: SlowGit) -> None:
    hang, started = slow_git.hang, slow_git.started

    async def stopped_in_a_pass() -> int:
        running = await Worker.started(paths)
        hang.touch()
        task = asyncio.ensure_future(running.run_pass())
        try:
            while not started.exists():
                assert not task.done(), task.result()
                await asyncio.sleep(0.01)
            return int(started.read_text())
        finally:
            running.stop()
            task.cancel()  # as the Watcher does when stopping
            await asyncio.gather(task, return_exceptions=True)

    assert _gone(asyncio.run(stopped_in_a_pass()))


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

    def no_terminals(_: Paths) -> terminals.Result:
        return terminals.Result(None)

    monkeypatch.setattr(terminals, "observe", no_terminals)
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


def test_a_failing_ionice_only_warns(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    lowered: list[tuple[int, int, int]] = []

    def setpriority(which: int, who: int, priority: int) -> None:  # not for this process
        lowered.append((which, who, priority))

    monkeypatch.setattr(os, "setpriority", setpriority)
    monkeypatch.setenv("PATH", str(tmp_path))  # no ionice
    caplog.set_level(logging.WARNING)
    worker._lower_priority()  # noqa: SLF001  # pyright: ignore[reportPrivateUsage] - as the worker starts
    assert lowered == [(os.PRIO_PROCESS, 0, worker.NICENESS)]
    assert "git runs at normal I/O priority: ionice failed: " in caplog.text
