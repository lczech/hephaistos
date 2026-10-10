import pytest
from typer.testing import CliRunner

from hephaistos.cli.main import app
from hephaistos.core.registry import machines
from hephaistos.core.utils.paths import Paths
from hephaistos.daemon.errors import EX_CONFIG
from support import logged, run_cli

runner = CliRunner()


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
    monkeypatch.setenv("HEPHAISTOS_WATCHER_ENABLED", "false")
    assert run_cli(monkeypatch, "daemon", "run") == EX_CONFIG
    message = "no Daemon parts are enabled: watcher.enabled is false"
    assert capsys.readouterr().err == f"error: {message}\n"


def test_a_broken_config_doesnt_start_it(
    paths: Paths, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    machines.set_up(paths, "laptop")
    monkeypatch.setenv("HEPHAISTOS_WATCHER_INTERVAL", "0")
    assert run_cli(monkeypatch, "daemon", "run") == EX_CONFIG
    problem = "HEPHAISTOS_WATCHER_INTERVAL: must be at least 1, not 0.0"
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
    monkeypatch.setenv("HEPHAISTOS_WATCHER_INTERVAL", "0")
    monkeypatch.setenv("PATH", "/nonexistent")  # no systemctl
    assert run_cli(monkeypatch, "daemon", "status") == 3  # not running
    problem = "HEPHAISTOS_WATCHER_INTERVAL: must be at least 1, not 0.0"
    assert capsys.readouterr().err == f"warning: {problem}; using the defaults\n"
