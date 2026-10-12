import json
import os
import socket
import sys
from datetime import UTC, datetime

import pytest
from typer.testing import CliRunner

import hephaistos.daemon
from hephaistos.cli.main import app
from hephaistos.core.registry import machines
from hephaistos.core.utils.paths import Paths
from hephaistos.daemon import status
from hephaistos.daemon.errors import EX_CONFIG
from hephaistos.daemon.server import token
from hephaistos.daemon.status import ServerStatus, Status
from support import logged, run_cli

runner = CliRunner()
NOW = datetime.now(UTC)


def test_not_set_up_doesnt_start(
    paths: Paths, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    assert run_cli(monkeypatch, "daemon", "run") == EX_CONFIG
    message = "hephaistos is not set up on this Machine; run `hephaistos setup`"
    assert capsys.readouterr().err == f"error: {message}\n"
    last = logged(paths)[-1]
    assert (last["process"], last["message"]) == ("daemon", f"end: error: {message}")
    assert last["exit_code"] == EX_CONFIG


def test_without_parts_doesnt_start(
    paths: Paths, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    machines.set_up(paths, "laptop")
    monkeypatch.setenv("HEPHAISTOS_WATCHER_INTERVAL", "0")
    monkeypatch.setenv("HEPHAISTOS_SERVER_ENABLED", "false")
    assert run_cli(monkeypatch, "daemon", "run") == EX_CONFIG
    message = "nothing to do: watcher.interval is 0 and server.enabled is false"
    assert capsys.readouterr().err == f"error: {message}\n"


def test_a_missing_package_doesnt_start_it(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    for name in ("hephaistos.daemon.main", "hephaistos.daemon.server.server"):
        monkeypatch.delitem(sys.modules, name, raising=False)
    monkeypatch.delattr(hephaistos.daemon, "main", raising=False)
    monkeypatch.setitem(sys.modules, "uvicorn", None)  # importing it fails
    assert run_cli(monkeypatch, "daemon", "run") == EX_CONFIG
    error = capsys.readouterr().err
    assert error.startswith("error: hephaistos is missing the package uvicorn; reinstall it")
    assert "uv tool install --reinstall --editable " in error  # from this checkout


def test_a_broken_config_doesnt_start_it(
    paths: Paths, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    machines.set_up(paths, "laptop")
    monkeypatch.setenv("HEPHAISTOS_WATCHER_INTERVAL", "0.5")
    assert run_cli(monkeypatch, "daemon", "run") == EX_CONFIG
    problem = "HEPHAISTOS_WATCHER_INTERVAL: must be 0 or at least 1, not 0.5"
    assert capsys.readouterr().err == f"error: {problem}\n"


@pytest.mark.usefixtures("paths")
def test_doctor_who() -> None:
    assert "--doctor-who" not in runner.invoke(app, ["daemon", "run", "--help"]).output
    result = runner.invoke(app, ["daemon", "run", "--doctor-who"])  # not set up: no Daemon
    assert result.exit_code == 0
    assert len(result.output.splitlines()) == 10


def test_other_commands_run_on_a_broken_config(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("HEPHAISTOS_WATCHER_INTERVAL", "0.5")
    monkeypatch.setenv("PATH", "/nonexistent")  # no systemctl
    assert run_cli(monkeypatch, "daemon", "status") == 3  # not running
    problem = "HEPHAISTOS_WATCHER_INTERVAL: must be 0 or at least 1, not 0.5"
    assert capsys.readouterr().err == f"warning: {problem}; using the defaults\n"


def test_token(paths: Paths) -> None:
    printed = runner.invoke(app, ["daemon", "token"])
    assert printed.exit_code == 0
    assert printed.output == f"{token.token(paths)}\n"
    refused = runner.invoke(app, ["daemon", "token", "--renew"])  # no terminal to ask at
    assert "add --yes to renew it" in str(refused.exception)
    assert token.token(paths) in printed.output
    renewed = runner.invoke(app, ["daemon", "token", "--renew", "--yes"]).output
    assert renewed == f"{token.token(paths)}\n" != printed.output


def test_token_url_only_for_our_own_server(paths: Paths) -> None:
    def url() -> str:
        result = runner.invoke(app, ["daemon", "token", "--url"])
        return result.output if result.exit_code == 0 else str(result.exception)

    assert url() == "the Server isn't running; see `hephaistos daemon status`"
    paths.state_dir.mkdir(parents=True)
    with socket.socket() as ours, status.held_lock(paths.state_dir):
        ours.bind(("127.0.0.1", 0))
        port = ours.getsockname()[1]
        listening = ServerStatus(f"127.0.0.1:{port}", listening=True)
        status.write(paths.state_dir, Status(os.getpid(), "0.1.0", NOW, server=listening))
        assert url() == f"port {port} isn't your Server's; not giving out the token"
        ours.listen()
        assert url() == f"http://127.0.0.1:{port}/#token={token.token(paths)}\n"


@pytest.mark.parametrize(
    ("server", "line"),
    [
        (ServerStatus("127.0.0.1:8264", listening=False), "starting"),
        (
            ServerStatus("127.0.0.1:8264", listening=False, error="port 8264 is in use"),
            "failed: port 8264 is in use",
        ),
        (
            ServerStatus("127.0.0.1:8264", listening=True),
            "listening on 127.0.0.1:8264; no requests yet",
        ),
        (
            ServerStatus("127.0.0.1:8264", listening=True, requests=1, last_request_at=NOW),
            "listening on 127.0.0.1:8264; 1 request since start, last now",
        ),
        (
            ServerStatus(
                "127.0.0.1:8264", listening=True, requests=12, last_request_at=NOW, refused=3
            ),
            "listening on 127.0.0.1:8264; 12 requests since start, last now; 3 refused",
        ),
    ],
)
def test_status_of_the_server(
    paths: Paths,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    *,
    server: ServerStatus,
    line: str,
) -> None:
    monkeypatch.setenv("PATH", "/nonexistent")  # no systemctl
    paths.state_dir.mkdir(parents=True)
    found = Status(os.getpid(), "0.1.0", NOW, parts=("server",), server=server)
    status.write(paths.state_dir, found)
    with status.held_lock(paths.state_dir):
        assert run_cli(monkeypatch, "daemon", "status") == 0
        assert capsys.readouterr().out.splitlines()[2:] == [
            "Last pass  none yet",
            "Watcher    passes only on request (watcher.interval is 0)",
            f"Server     {line}",
        ]
        assert run_cli(monkeypatch, "daemon", "status", "--json") == 0
    shown = json.loads(capsys.readouterr().out)
    assert shown["unit"] is None
    assert shown["daemon"]["running"]
    assert shown["daemon"]["pid"] == os.getpid()
    assert shown["watcher"] == {
        "interval": 0.0,
        "last_pass": None,
        "next_pass_at": None,
        "stalled": False,
    }
    assert shown["server"]["listening"] == server.listening
    assert shown["server"]["requests"] == server.requests
