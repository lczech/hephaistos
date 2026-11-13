import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from typer.testing import CliRunner

from hephaistos.cli.main import app
from hephaistos.core import serialize
from hephaistos.core.registry import machines
from hephaistos.core.serialize import CodeJson
from hephaistos.core.utils import logs
from hephaistos.core.utils.paths import Paths, short_path
from hephaistos.daemon import status, unit
from hephaistos.daemon.status import Check, Checked, Status

runner = CliRunner()


@pytest.fixture(autouse=True)
def no_systemd(monkeypatch: pytest.MonkeyPatch) -> None:
    """Never the real systemd of the user."""
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
    assert lines[2].split()[0] == "tmux"
    assert lines[4].split(maxsplit=2) == [
        "systemd",
        "note",
        "no user services here; run `hephaistos daemon run`, e.g. in tmux",
    ]
    assert "checked by the daemon" not in result.output  # none runs
    assert lines[lines.index("Running:") + 2] == "  Daemon  not running; never ran"
    assert "  systemd     unknown" in lines
    assert lines[-1] == "Log: no errors or warnings in the last 24 h"


def test_status_lists_the_daemons_other_findings(paths: Paths) -> None:
    machines.set_up(paths, "laptop")
    paths.state_dir.mkdir(parents=True, exist_ok=True)
    now = datetime.now(UTC)  # not that of the module: "5m ago" must hold when this runs
    _warn(paths, now - timedelta(hours=2), "WARNING")
    _warn(paths, now - timedelta(hours=1), "ERROR")
    shell = runner.invoke(app, ["status", "--json"])
    sqlite = next(
        check for check in json.loads(shell.output)["checks"] if check["name"] == "sqlite"
    )
    checks = (
        Check("git", "problem", "git is not installed", "install git"),
        Check("sqlite", "ok", sqlite["text"]),  # as in the shell: not listed
    )
    started = now - timedelta(minutes=5)
    daemon = Status(4242, "0.1.0", started, checks=Checked(started, checks))
    status.write(paths.state_dir, daemon)
    with status.held_lock(paths.state_dir):
        result = runner.invoke(app, ["status"])
    assert result.exit_code == 0, result.output
    lines = result.output.splitlines()
    heading = lines.index("Setup, checked by the daemon 5m ago:")
    assert lines[heading + 1].split(maxsplit=2) == [
        "git",
        "problem",
        "git is not installed; install git",
    ]
    assert lines[heading + 2] == "About:"
    assert lines.index("About:") < lines.index("Running:")
    assert lines[-1] == (
        "Log: 1 error and 1 warning in the last 24 h;"
        " see them with `hephaistos log show --level warning --since 24h`"
    )
    answer = json.loads(shell.output)
    assert answer["daemon"]["checks"] is None  # not running then
    assert (answer["log"]["errors"], answer["log"]["warnings"]) == (1, 1)


def test_status_shows_the_paths_with_sizes(paths: Paths) -> None:
    machines.set_up(paths, "laptop")
    now = datetime.now(UTC)
    _warn(paths, now, "INFO")
    paths.desktop_log.write_bytes(b"x" * 100)
    logged = logs.day_file(paths.state_dir, now.date()).stat().st_size + 100
    result = runner.invoke(app, ["status", "--json"])
    found = json.loads(result.output)["paths"]
    assert found["code"]["checkout"]
    assert found["code"]["size"] is None
    assert found["data"]["path"] == str(paths.data_dir)
    assert found["data"]["size"] >= paths.database.stat().st_size
    assert found["logs"]["size"] == logged  # the logs only, not the status file and the like
    assert found["desktop"] == {"path": str(paths.desktop_profile), "exists": False, "size": None}

    (paths.desktop_profile / "Cache").mkdir(parents=True)
    (paths.desktop_profile / "Cache" / "data_0").write_bytes(b"x" * 2000)
    lines = runner.invoke(app, ["status"]).output.splitlines()
    heading = lines.index("Paths:")
    assert lines.index("About:") < heading < lines.index("Running:")
    assert lines[heading + 4] == f"  Logs    {short_path(paths.state_dir)} ({logged} B of logs)"
    assert lines[heading + 5] == f"  App     {short_path(paths.desktop_profile)} (2.0 kB)"
    assert lines[heading + 6] == "Running:"


def test_status_lists_the_daemons_other_paths(paths: Paths, tmp_path: Path) -> None:
    machines.set_up(paths, "laptop")
    own = serialize.hephaistos_paths_json(paths)
    other = tmp_path / "other"
    theirs = own.copy()
    theirs["code"] = CodeJson(path=str(other), exists=True, size=None, checkout=True)
    status.write(paths.state_dir, Status(4242, "0.1.0", datetime.now(UTC), paths=theirs))
    with status.held_lock(paths.state_dir):
        lines = runner.invoke(app, ["status"]).output.splitlines()
    heading = lines.index("Paths of the daemon, where they differ:")
    # Whether it exists comes from now, not from when the Daemon started.
    assert lines[heading + 1] == f"  Code  {short_path(other)} (not there yet)"
    assert lines[heading + 2] == "Running:"
