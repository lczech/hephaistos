import dataclasses
import json
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from typer.testing import CliRunner

from hephaistos.cli import terminal
from hephaistos.cli.main import app
from hephaistos.core import config
from hephaistos.core.utils import logs
from hephaistos.core.utils.paths import Paths

runner = CliRunner()

NOW = datetime.now(UTC).replace(microsecond=123000)
TRACEBACK = "Traceback (most recent call last):\n  File \"x.py\", line 1\nKeyError: 'branch'"


def _write(paths: Paths, at: datetime, message: str, level: str = "INFO", **fields: object) -> None:
    record = {"at": at.isoformat(), "level": level, "process": "cli", "pid": 7, "message": message}
    paths.state_dir.mkdir(parents=True, exist_ok=True)
    with logs.day_file(paths.state_dir, at.date()).open("a") as file:
        file.write(logs.json_text(record | fields) + "\n")


def test_show(paths: Paths) -> None:
    _write(paths, NOW - timedelta(days=1), "yesterday", "WARNING")
    _write(paths, NOW - timedelta(minutes=2), "unexpected KeyError", "ERROR", error=TRACEBACK)
    _write(paths, NOW - timedelta(minutes=1), "recorded clone.registered", event="e1")
    with logs.day_file(paths.state_dir, NOW.date()).open("a") as file:
        file.write("cut sho\n")

    result = runner.invoke(app, ["log", "show"])
    assert result.exit_code == 0, result.output
    lines = result.stdout.splitlines()
    assert len(lines) == 6
    assert lines[0].endswith("WARNING cli[7] yesterday")
    assert lines[1].endswith("ERROR cli[7] unexpected KeyError")
    assert lines[-1].endswith("INFO  cli[7] recorded clone.registered event=e1")
    assert result.stderr == "skipped 1 unreadable line\n"

    reverse = runner.invoke(app, ["log", "show", "--reverse", "-n", "2"]).stdout.splitlines()
    assert reverse[0].endswith("INFO  cli[7] recorded clone.registered event=e1")
    assert reverse[1].endswith("ERROR cli[7] unexpected KeyError")
    brief = runner.invoke(app, ["log", "show", "--brief", "-n", "2", "--level", "error"])
    assert brief.stdout.splitlines()[1:] == ["    ↳ KeyError: 'branch'"]
    ninety_seconds_before = (NOW - timedelta(seconds=90)).isoformat()
    since = runner.invoke(app, ["log", "show", "--since", ninety_seconds_before, "--json"])
    [entry] = [json.loads(line) for line in since.stdout.splitlines()]
    assert entry["record"]["event"] == "e1"
    assert entry["position"].startswith(f"{NOW.date()}:")


@pytest.mark.usefixtures("paths")
@pytest.mark.parametrize("refused", ["--until", "--reverse"])
def test_show_follow_refuses(refused: str) -> None:
    args = [refused, "1h"] if refused == "--until" else [refused]
    result = runner.invoke(app, ["log", "show", "--follow", *args])
    assert result.exit_code == 2
    assert f"leave out {refused}" in result.output


def test_pages_on_a_terminal(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    paged = tmp_path / "paged"
    monkeypatch.setattr(sys.stdout, "isatty", lambda: True)
    monkeypatch.setenv("PAGER", f"sh -c 'cat > {paged}'")
    terminal.page("one\ntwo")
    assert paged.read_text() == "one\ntwo\n"


def test_prune(paths: Paths, monkeypatch: pytest.MonkeyPatch) -> None:
    today = NOW.date()
    for days in (40, 8, 7, 0):
        _write(paths, NOW - timedelta(days=days), f"{days} days ago")
    (paths.state_dir / "notes.txt").write_text("not a log")

    refused = runner.invoke(app, ["log", "prune", "--keep", "7d"])
    assert refused.exit_code == 1
    assert "add --yes to delete them" in str(refused.exception)

    monkeypatch.setattr(terminal, "interactive", lambda: True)
    declined = runner.invoke(app, ["log", "prune", "--keep", "7d"], input="n\n")
    assert declined.exit_code == 1
    assert declined.output.splitlines()[1].endswith(
        f"{today - timedelta(days=40)} to {today - timedelta(days=8)}: 2 files"
    )
    assert len(logs.day_files(paths.state_dir)) == 4

    result = runner.invoke(app, ["log", "prune", "--keep", "7d", "--yes"])
    assert result.exit_code == 0, result.output
    assert result.output.startswith("Deleted 2 log files (")
    assert [day for day, _ in logs.day_files(paths.state_dir)] == [
        today - timedelta(days=7),
        today,
    ]
    assert (paths.state_dir / "notes.txt").exists()
    assert runner.invoke(app, ["log", "prune", "--keep", "7d"]).output == "Nothing to prune\n"

    retention = dataclasses.replace(config.DEFAULTS.log, retention_days=0)
    config.activate(dataclasses.replace(config.DEFAULTS, log=retention))
    everything = runner.invoke(app, ["log", "prune", "--yes"])
    assert everything.output.startswith("Deleted 1 log file (")
    assert [day for day, _ in logs.day_files(paths.state_dir)] == [today]


@pytest.mark.usefixtures("paths")
def test_prune_takes_days() -> None:
    result = runner.invoke(app, ["log", "prune", "--keep", "2w"])
    assert result.exit_code == 2
    assert "not a number of days like 7d" in result.output
