import json
import re
import socket
from datetime import UTC, datetime, timedelta
from typing import get_args

import pytest
import typer
from typer.testing import CliRunner

from hephaistos.cli.event import PriorityName, parse_since
from hephaistos.cli.main import app
from hephaistos.core.events.kinds import Priority
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.paths import Paths

runner = CliRunner()


@pytest.fixture(autouse=True)
def set_up(paths: object) -> None:
    """A Machine with Repository `project`, renamed from `proj`."""
    del paths
    runner.invoke(app, ["setup", "--name", "laptop"])
    runner.invoke(app, ["repo", "add", "proj"])
    runner.invoke(app, ["repo", "rename", "proj", "project"])


def _rows(*args: str) -> list[list[str]]:
    result = runner.invoke(app, ["event", "list", *args])
    assert result.exit_code == 0, result.output
    return [line.split() for line in result.output.splitlines()[1:]]


def test_list() -> None:
    result = runner.invoke(app, ["event", "list"])
    lines = result.output.splitlines()
    assert lines[0].split() == [
        "id",
        "recorded",
        "machine",
        "priority",
        "kind",
        "subject",
        "summary",
    ]
    rows = [re.split(r"\s{2,}", line) for line in lines[1:]]
    assert [row[1:] for row in rows] == [
        ["now", "laptop", "normal", "repository.changed", "project", "name: proj → project"],
        ["now", "laptop", "normal", "repository.added", "project"],
        ["now", "laptop", "normal", "mount.added", "/", "/"],
        ["now", "laptop", "normal", "filesystem.added", "laptop-local"],
        ["now", "laptop", "normal", "machine.added", "laptop", socket.gethostname()],
    ]
    assert all(re.fullmatch(r"[0-9a-f]{8}", row[0]) for row in rows)


@pytest.mark.parametrize(
    ("args", "kinds"),
    [
        (["-k", "repository"], ["repository.changed", "repository.added"]),
        (["-k", "machine", "-k", "mount"], ["mount.added", "machine.added"]),
        (["--kind", "*.added", "-n", "2"], ["repository.added", "mount.added"]),
        (["-p", "high"], []),
        (["-p", "normal", "-n", "1"], ["repository.changed"]),
        (["-m", "laptop", "-s", "1h", "-n", "1"], ["repository.changed"]),
        (["-n", "0", "-k", "machine"], ["machine.added"]),
    ],
)
def test_filters(args: list[str], kinds: list[str]) -> None:
    assert [row[4] for row in _rows(*args)] == kinds


def test_unknown_machine() -> None:
    result = runner.invoke(app, ["event", "list", "-m", "desktop"])
    assert isinstance(result.exception, HephaistosError)


def test_bad_since() -> None:
    result = runner.invoke(app, ["event", "list", "--since", "yesterday"])
    assert result.exit_code == 2
    assert "neither a duration" in result.output


def test_time_format_option_and_config(paths: Paths) -> None:
    full = r"\d{4}-\d\d-\d\d \d\d:\d\d:\d\d"
    lines = runner.invoke(app, ["event", "list", "--time-format", "full"]).output.splitlines()
    assert re.search(full, lines[1])

    paths.config_file.write_text('time_format = "full"\n')
    assert re.search(full, runner.invoke(app, ["event", "list"]).output.splitlines()[1])


def test_show_change() -> None:
    short = _rows("-n", "1")[0][0]
    result = runner.invoke(app, ["event", "show", short])
    assert result.exit_code == 0, result.output
    lines = [line.split(maxsplit=1) for line in result.output.splitlines()]
    assert ["kind", "repository.changed"] in lines
    assert ["subject", "project"] in lines
    assert lines[-2:] == [["payload"], ["name", "proj → project"]]


def test_json() -> None:
    [event] = json.loads(runner.invoke(app, ["event", "list", "-n", "1", "--json"]).output)
    assert event["kind"] == "repository.changed"
    assert event["machine"] == "laptop"
    assert event["subject_label"] == "project"
    assert event["priority"] == 20
    assert event["payload"] == {"name": {"old": "proj", "new": "project"}}
    assert datetime.fromisoformat(event["recorded_at"]) <= datetime.now(UTC)

    shown = json.loads(runner.invoke(app, ["event", "show", event["id"], "--json"]).output)
    assert shown == event


def test_parse_since() -> None:
    now = datetime(2026, 10, 5, 14, 0, tzinfo=UTC)
    assert parse_since("30m", now) == now - timedelta(minutes=30)
    assert parse_since("2d", now) == now - timedelta(days=2)
    assert parse_since("2026-10-01", now) == datetime(2026, 10, 1).astimezone()
    assert parse_since("2026-10-01T08:00+02:00", now) == datetime(2026, 10, 1, 6, 0, tzinfo=UTC)
    with pytest.raises(typer.BadParameter):
        parse_since("2 hours", now)


def test_priority_names_match() -> None:
    assert get_args(PriorityName) == tuple(priority.name.lower() for priority in Priority)
