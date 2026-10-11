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
from collections.abc import Callable
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
from hephaistos.daemon.watcher.schedule import Watcher
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
    config.activate(
        dataclasses.replace(config.DEFAULTS, watcher=config.Watcher(enabled=True, interval=1.0))
    )
    reported: list[PassStatus] = []

    async def watched() -> None:
        watcher = Watcher(paths, reported.append)
        task = asyncio.create_task(watcher.run())
        while len(reported) < 3:
            if len(reported) == 1:
                watcher.kill()
            await asyncio.sleep(0.05)
        task.cancel()

    asyncio.run(asyncio.wait_for(watched(), WAIT))
    assert [done.error for done in reported[:3]] == [
        None,
        "the worker died: killed by SIGKILL",
        None,
    ]


def _daemon(*args: str, port: int | None = None) -> subprocess.Popen[str]:
    """`hephaistos daemon run` in a new process, passing a pass a second; with a Server on
    `port`, else none."""
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
        env=os.environ | {"HEPHAISTOS_WATCHER_INTERVAL": "1"} | server,
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


def _get(port: int, path: str, headers: dict[str, str]) -> tuple[int, Any]:
    """The status and JSON with which the Server on `port` answers a GET, without proxies."""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    request = urllib.request.Request(f"http://127.0.0.1:{port}{path}", headers=headers)
    try:
        with opener.open(request, timeout=WAIT) as response:
            return response.status, json.loads(response.read())
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
