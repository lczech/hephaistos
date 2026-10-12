import asyncio
import dataclasses
import json
import logging
import os
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from hephaistos import __version__
from hephaistos.core import config
from hephaistos.core.db.sessions import read_session
from hephaistos.core.events import events
from hephaistos.core.utils.paths import Paths
from hephaistos.daemon import main, status
from hephaistos.daemon.errors import EX_CONFIG
from hephaistos.daemon.server import token
from hephaistos.daemon.status import PassStatus, ServerStatus, Status
from hephaistos.daemon.watcher.watcher import Watcher
from hephaistos.daemon.watcher.worker import Done, PassFailed
from support import create, git, logged

WAIT = 20.0  # seconds a test waits for the Daemon at most


def _until[T](found: Callable[[], T | None]) -> T:
    """What `found` returns once it is something, polling until WAIT has passed."""
    deadline = time.monotonic() + WAIT
    while (value := found()) is None:
        assert time.monotonic() < deadline, "timed out"
        time.sleep(0.05)
    return value


class Crashing:
    """A part that crashes twice, then runs until cancelled."""

    name = "crashing"

    def __init__(self) -> None:
        self.runs = 0
        self.steady = asyncio.Event()

    async def run(self) -> None:
        self.runs += 1
        if self.runs <= 2:
            raise RuntimeError(self.runs)
        self.steady.set()
        await asyncio.Event().wait()

    def kill(self) -> None:
        pass


def test_crashed_parts_restart_ever_later(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(main, "FIRST_RESTART_DELAY", 0.01)
    part = Crashing()

    async def restarted() -> None:
        task = asyncio.create_task(main.keep_running(part))
        await asyncio.wait_for(part.steady.wait(), WAIT)
        task.cancel()

    caplog.set_level(logging.INFO)
    asyncio.run(restarted())
    assert part.runs == 3
    assert [record.getMessage() for record in caplog.records] == [
        "crashing crashed",
        "restarting crashing in 0.01 s",
        "crashing crashed",
        "restarting crashing in 0.02 s",
    ]
    assert caplog.records[0].exc_info is not None


@pytest.mark.usefixtures("repo")
def test_watcher_replaces_a_dead_worker(paths: Paths) -> None:
    config.activate(dataclasses.replace(config.DEFAULTS, watcher=config.Watcher(interval=1.0)))
    reported: list[PassStatus] = []

    async def watched() -> None:
        watcher = Watcher(paths, reported.append)
        task = asyncio.create_task(watcher.run())
        while len(reported) < 3:
            if len(reported) == 1:
                watcher.kill()
            await asyncio.sleep(0.05)
        task.cancel()
        await watcher.stop()

    asyncio.run(asyncio.wait_for(watched(), WAIT))
    assert [done.error for done in reported[:3]] == [
        None,
        "the worker died: killed by SIGKILL",
        None,
    ]


DONE = Done(events=0, observed=1, worktrees=0, updated=0, skipped=0)


class Passes:
    """Stands in for the worker: each pass waits until released, and is counted."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.started = 0
        self.release = asyncio.Event()
        monkeypatch.setattr(Watcher, "_worker_pass", self._method())

    def _method(self) -> Callable[[Watcher], Awaitable[Done | PassFailed]]:
        """`_pass` as a method of the Watcher."""

        def method(_: Watcher) -> Awaitable[Done | PassFailed]:
            return self._pass()

        return method

    async def _pass(self) -> Done | PassFailed:
        self.started += 1
        await self.release.wait()
        return DONE


def test_requests_share_the_pass_after_the_running_one(
    paths: Paths, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG, "hephaistos.daemon.watcher")
    passes = Passes(monkeypatch)
    reported: list[PassStatus] = []

    async def requested() -> None:
        watcher = Watcher(paths, reported.append)
        first = asyncio.create_task(watcher.observe("api"))
        await asyncio.sleep(0.01)
        assert passes.started == 1
        later = [asyncio.create_task(watcher.observe("api")) for _ in range(3)]
        await asyncio.sleep(0.01)
        assert passes.started == 1  # they wait for the running pass to end
        passes.release.set()
        assert await first is DONE
        assert [await task for task in later] == [DONE] * 3
        assert passes.started == 2  # one more, for all three
        await watcher.stop()

    asyncio.run(asyncio.wait_for(requested(), WAIT))
    assert [done.trigger for done in reported] == ["api", "api"]
    assert [getattr(record, "trigger", None) for record in caplog.records] == ["api", "api"]


def test_the_timer_counts_from_any_pass(paths: Paths, monkeypatch: pytest.MonkeyPatch) -> None:
    config.activate(dataclasses.replace(config.DEFAULTS, watcher=config.Watcher(interval=1.0)))
    passes = Passes(monkeypatch)
    passes.release.set()
    ended: list[tuple[float, str]] = []
    third = asyncio.Event()

    def report(done: PassStatus) -> None:
        ended.append((time.monotonic(), done.trigger))
        if len(ended) == 3:
            third.set()

    async def watched() -> None:
        watcher = Watcher(paths, report)
        timer = asyncio.create_task(watcher.run())
        await asyncio.sleep(0.5)
        await watcher.observe("api")
        await third.wait()
        timer.cancel()
        await watcher.stop()

    asyncio.run(asyncio.wait_for(watched(), WAIT))
    assert [trigger for _, trigger in ended[:3]] == ["watcher", "api", "watcher"]
    assert ended[2][0] - ended[1][0] >= 1.0  # not 0.5 s, as from the timer's own pass


def test_a_pass_cut_short_by_stopping(paths: Paths, monkeypatch: pytest.MonkeyPatch) -> None:
    passes = Passes(monkeypatch)

    async def stopped() -> None:
        watcher = Watcher(paths, lambda _: None)
        request = asyncio.create_task(watcher.observe("api"))
        await asyncio.sleep(0.01)
        await watcher.stop()
        with pytest.raises(asyncio.CancelledError):
            await request

    asyncio.run(asyncio.wait_for(stopped(), WAIT))
    assert passes.started == 1


def _daemon(*args: str, port: int | None = None, interval: int = 1) -> subprocess.Popen[str]:
    """`hephaistos daemon run` in a new process, passing every `interval` seconds; with a
    Server on `port`, else none."""
    server = (
        {"HEPHAISTOS_SERVER_ENABLED": "false"}
        if port is None
        else {"HEPHAISTOS_SERVER_PORT": str(port)}
    )
    return subprocess.Popen(
        [
            sys.executable,
            "-c",
            "from hephaistos.cli.main import run; run()",
            "daemon",
            "run",
            *args,
        ],
        env=os.environ | {"HEPHAISTOS_WATCHER_INTERVAL": str(interval)} | server,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def _running(paths: Paths, daemon: subprocess.Popen[str]) -> Status | None:
    """The Daemon's status, once its Watcher has reported its first pass."""
    found = status.read(paths.state_dir)
    if found is None or found.pid != daemon.pid or found.watcher is None:
        return None
    return found


def _messages(paths: Paths) -> list[object]:
    """The Daemon's log records, by their message."""
    return [record["message"] for record in logged(paths) if record["process"] == "daemon"]


def test_observes_until_stopped(paths: Paths, repo: Path) -> None:
    daemon = _daemon()
    try:
        assert _until(lambda: _running(paths, daemon)).stopped_at is None
        git(repo, "commit", "--quiet", "--allow-empty", "--message", "two")

        def committed() -> bool | None:
            with read_session(paths) as session:
                kinds = [event.kind for event in events.recent(session)]
            return True if "clone.committed" in kinds else None

        _until(committed)

        second = _daemon()
        _, err = second.communicate(timeout=WAIT)
        assert second.returncode == EX_CONFIG
        assert err == f"error: a Daemon is already running on this Machine (pid {daemon.pid})\n"
    finally:
        daemon.send_signal(signal.SIGTERM)
        out, err = daemon.communicate(timeout=WAIT)
    assert daemon.returncode == 0, err
    assert (out, err) == ("", "Running: watcher; Ctrl+C stops the Daemon\n")
    stopped = status.read(paths.state_dir)
    assert stopped is not None
    assert stopped.stopped_at is not None
    messages = _messages(paths)
    assert messages[0] == "start: hephaistos daemon run"
    assert messages[1] == "running: watcher"
    assert "pass: 1 Events" in messages
    assert messages[-2:] == ["stopped: SIGTERM", "end: ok"]
    with status.held_lock(paths.state_dir):  # released, as the worker ended too
        pass


@pytest.mark.usefixtures("repo")
def test_ctrl_c_stops_it_and_a_crash_is_noticed(paths: Paths) -> None:
    status.write(paths.state_dir, Status(41233, "0.1.0", datetime.now(UTC)))  # never stopped
    daemon = _daemon()
    _until(lambda: _running(paths, daemon))
    daemon.send_signal(signal.SIGINT)
    daemon.communicate(timeout=WAIT)
    assert daemon.returncode == 0
    assert "the previous Daemon (pid 41233) ended without stopping" in _messages(paths)
    assert "stopped: SIGINT" in _messages(paths)


def test_running_version(tmp_path: Path) -> None:
    assert main.running_version(tmp_path) == __version__  # not a checkout
    checkout = create(tmp_path / "checkout")
    (checkout / "src" / "hephaistos").mkdir(parents=True)
    short = git(checkout, "rev-parse", "--short", "HEAD")
    assert main.running_version(checkout) == f"{__version__} ({short})"


def _get(port: int, path: str, headers: dict[str, str], method: str = "GET") -> tuple[int, Any]:
    """The status and JSON, if any, with which the Server on `port` answers, without proxies."""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    url = f"http://127.0.0.1:{port}{path}"
    request = urllib.request.Request(url, headers=headers, method=method)
    try:
        with opener.open(request, timeout=WAIT) as response:
            body = response.read()
            return response.status, json.loads(body) if body else None
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def _server(paths: Paths, daemon: subprocess.Popen[str]) -> ServerStatus | None:
    """How the Daemon's Server is doing, once it listens or failed."""
    found = status.read(paths.state_dir)
    if found is None or found.pid != daemon.pid or found.server is None:
        return None
    done = found.server
    return done if done.listening or done.error else None


@pytest.mark.usefixtures("repo")
def test_serves_until_stopped(paths: Paths) -> None:
    daemon = _daemon(port=0)  # a free port, as it reports
    try:
        port = _until(lambda: _server(paths, daemon)).port
        assert port > 0
        value = token.token(paths)
        status_code, info = _get(port, "/api/info", {"Authorization": f"Bearer {value}"})
        assert status_code == 200
        assert info["machine"]["name"] == "laptop"
        refusals = [
            _get(port, "/api/info", {}),
            _get(port, f"/api/info?token={value}", {"Authorization": "Bearer wrong"}),
            _get(port, "/api/info", {"Authorization": f"Bearer {value}", "Host": "evil.example"}),
        ]
        assert [(code, answer["error"].split(";")[0]) for code, answer in refusals] == [
            (401, "no token"),
            (401, "wrong token"),
            (400, "this Server answers only to localhost, not to evil.example"),
        ]
        counted = _until(lambda: _server(paths, daemon) if _requests(paths) else None)
        assert (counted.requests, counted.refused) == (1, 3)
    finally:
        daemon.send_signal(signal.SIGTERM)
        _, err = daemon.communicate(timeout=WAIT)
    assert daemon.returncode == 0, err
    assert err == "Running: watcher, server; Ctrl+C stops the Daemon\n"
    messages = _messages(paths)
    assert f"listening on 127.0.0.1:{port}" in messages
    assert "refused GET /api/info?token=… from 127.0.0.1: wrong token" in str(messages)
    assert value not in str(logged(paths))


def _requests(paths: Paths) -> int:
    found = status.read(paths.state_dir)
    return 0 if found is None or found.server is None else found.server.requests


@pytest.mark.usefixtures("repo")
def test_a_taken_port_fails_only_the_server(paths: Paths) -> None:
    with socket.socket() as taken:
        taken.bind(("127.0.0.1", 0))
        taken.listen()
        port = taken.getsockname()[1]
        daemon = _daemon(port=port)
        try:
            failed = _until(lambda: _server(paths, daemon))
            _until(lambda: _running(paths, daemon))
        finally:
            daemon.send_signal(signal.SIGTERM)
            daemon.communicate(timeout=WAIT)
    message = f"port {port} is in use; set server.port for this host"
    assert (failed.listening, failed.error) == (False, message)
    assert f"server failed: {message}" in _messages(paths)


@pytest.mark.usefixtures("repo")
def test_observes_on_request_only(paths: Paths) -> None:
    daemon = _daemon(port=0, interval=0)
    try:
        port = _until(lambda: _server(paths, daemon)).port
        headers = {"Authorization": f"Bearer {token.token(paths)}"}
        assert _get(port, "/api/observe", headers, method="POST") == (204, None)
        found = status.read(paths.state_dir)
        assert found is not None
        assert found.parts == ("server",)
        assert found.watcher is not None
        assert found.watcher.trigger == "api"
    finally:
        daemon.send_signal(signal.SIGTERM)
        _, err = daemon.communicate(timeout=WAIT)
    assert daemon.returncode == 0, err
    assert err == "Running: server; Ctrl+C stops the Daemon\n"
