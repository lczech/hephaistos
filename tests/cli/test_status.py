import json
from datetime import UTC, datetime, timedelta

import pytest
from typer.testing import CliRunner

from hephaistos.cli.main import app
from hephaistos.core.registry import machines
from hephaistos.core.utils import logs
from hephaistos.core.utils.paths import Paths
from hephaistos.daemon import status, unit
from hephaistos.daemon.status import Check, Checked, Status

runner = CliRunner()
NOW = datetime.now(UTC)


@pytest.fixture(autouse=True)
def no_systemd(monkeypatch: pytest.MonkeyPatch) -> None:
    """Never the user's own systemd."""
    monkeypatch.setattr(unit, "is_available", lambda: False)
    monkeypatch.setattr(unit, "version", lambda: None)
    monkeypatch.setattr(unit, "user_environment", dict)


def _warn(paths: Paths, at: datetime, level: str) -> None:
    record = {"at": at.isoformat(), "level": level, "process": "cli", "pid": 7, "message": "m"}
    with logs.day_file(paths.state_dir, at.date()).open("a") as file:
        file.write(logs.json_text(record) + "\n")


def test_status_without_a_daemon(paths: Paths) -> None:
    machines.set_up(paths, "laptop")
    result = runner.invoke(app, ["status"])
    assert result.exit_code == 0, result.output
    lines = result.output.splitlines()
    assert lines[0] == "Setup, checked in this shell:"
    assert lines[1].split()[:2] == ["git", "ok"]
    assert lines[3].split(maxsplit=2) == [
        "systemd",
        "note",
        "no user services here; run `hephaistos daemon run`, e.g. in tmux",
    ]
    assert "The daemon's" not in result.output  # none runs
    assert lines[lines.index("Running:") + 2] == "  Daemon  not running; never ran"
    assert "  systemd     unknown" in lines
    assert lines[-1] == "Log: no errors or warnings in the last 24 h"


def test_status_lists_the_daemons_other_findings(paths: Paths) -> None:
    machines.set_up(paths, "laptop")
    paths.state_dir.mkdir(parents=True, exist_ok=True)
    _warn(paths, NOW - timedelta(hours=2), "WARNING")
    _warn(paths, NOW - timedelta(hours=1), "ERROR")
    shell = runner.invoke(app, ["status", "--json"])
    sqlite = next(
        check for check in json.loads(shell.output)["checks"] if check["name"] == "sqlite"
    )
    checks = (
        Check("git", "problem", "git is not installed", "install git"),
        Check("sqlite", "ok", sqlite["text"]),  # as in the shell: not listed
    )
    started = datetime.now(UTC) - timedelta(minutes=5)  # NOW is that of collecting the tests
    daemon = Status(4242, "0.1.0", started, checks=Checked(started, checks))
    status.write(paths.state_dir, daemon)
    with status.held_lock(paths.state_dir):
        result = runner.invoke(app, ["status"])
    assert result.exit_code == 0, result.output
    lines = result.output.splitlines()
    heading = lines.index("The daemon's, checked 5m ago:")
    assert lines[heading + 1].split(maxsplit=2) == [
        "git",
        "problem",
        "git is not installed; install git",
    ]
    assert lines[heading + 2] == "Running:"
    assert lines[-1] == (
        "Log: 1 error and 1 warning in the last 24 h;"
        " `hephaistos log show --level warning --since 24h`"
    )
    answer = json.loads(shell.output)
    assert answer["daemon"]["checks"] is None  # not running then
    assert (answer["log"]["errors"], answer["log"]["warnings"]) == (1, 1)
