import dataclasses
import json
import re
import socket
from datetime import UTC, datetime
from typing import get_args

import pytest
from typer.testing import CliRunner

from hephaistos.cli.event import SUMMARY_WIDTH
from hephaistos.cli.main import app
from hephaistos.core import config
from hephaistos.core.config import TimeFormat
from hephaistos.core.db.sessions import write_session
from hephaistos.core.events import events
from hephaistos.core.events.kinds import EventKind, Priority, PriorityName
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.ids import new_id
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
        "priority",
        "kind",
        "repository",
        "machine",
        "subject",
        "summary",
    ]
    # Empty cells vanish in the split: Mounts and Machines have no Repository, and a
    # Repository's own Events no subject but it.
    rows = [re.split(r"\s{2,}", line) for line in lines[1:]]
    assert [row[1:] for row in rows] == [
        ["now", "normal", "machine.added", "laptop", "laptop", socket.gethostname()],
        ["now", "normal", "filesystem.added", "laptop", "laptop-local"],
        ["now", "normal", "mount.added", "laptop", "/", "/"],
        ["now", "normal", "repository.added", "project", "laptop"],
        ["now", "normal", "repository.changed", "project", "laptop", "name: proj → project"],
    ]
    newest = runner.invoke(app, ["event", "list", "--reverse", "-n", "2"]).output.splitlines()
    assert [line.split()[3] for line in newest[1:]] == ["repository.changed", "repository.added"]
    assert all(re.fullmatch(r"[0-9a-f]{8}", row[0]) for row in rows)


@pytest.mark.parametrize(
    ("args", "kinds"),
    [
        (["-k", "repository"], ["repository.added", "repository.changed"]),
        (["-k", "machine", "-k", "mount"], ["machine.added", "mount.added"]),
        (["--kind", "*.added", "-n", "2"], ["mount.added", "repository.added"]),
        (["-p", "high"], []),
        (["-p", "normal", "-n", "1"], ["repository.changed"]),
        (["-m", "laptop", "-s", "1h", "-n", "1"], ["repository.changed"]),
        (["-m", "laptop", "-m", "laptop", "-r", "project", "-n", "1"], ["repository.changed"]),
        (["-n", "0", "-k", "machine"], ["machine.added"]),
    ],
)
def test_filters(args: list[str], kinds: list[str]) -> None:
    assert [row[3] for row in _rows(*args)] == kinds


def test_unknown_machine() -> None:
    result = runner.invoke(app, ["event", "list", "-m", "desktop"])
    assert isinstance(result.exception, HephaistosError)


def test_bad_since() -> None:
    result = runner.invoke(app, ["event", "list", "--since", "yesterday"])
    assert result.exit_code == 2
    assert "neither a duration" in result.output


@pytest.mark.usefixtures("paths")
def test_time_format_option_and_setting() -> None:
    full = r"\d{4}-\d\d-\d\d \d\d:\d\d:\d\d"
    lines = runner.invoke(app, ["event", "list", "--time-format", "full"]).output.splitlines()
    assert re.search(full, lines[1])

    config.activate(dataclasses.replace(config.DEFAULTS, time_format=TimeFormat.FULL))
    assert re.search(full, runner.invoke(app, ["event", "list"]).output.splitlines()[1])


def test_show_change() -> None:
    short = _rows("-n", "1")[0][0]
    result = runner.invoke(app, ["event", "show", short])
    assert result.exit_code == 0, result.output
    lines = [line.split(maxsplit=1) for line in result.output.splitlines()]
    assert ["kind", "repository.changed"] in lines
    assert ["subject", "project"] in lines
    assert ["repository", "project"] in lines
    assert lines[-2:] == [["payload"], ["name", "proj → project"]]


def test_show_a_payload_that_isnt_an_object(paths: Paths) -> None:
    with write_session(paths) as session:
        recorded = events.record(session, EventKind.CLONE_FAILED, new_id(), ["not", "an", "object"])
    result = runner.invoke(app, ["event", "show", str(recorded.id)])
    assert result.exit_code == 0, result.output
    assert result.output.splitlines()[-1].split(maxsplit=1) == [
        "payload",
        '["not", "an", "object"]',
    ]


def test_json() -> None:
    [event] = json.loads(runner.invoke(app, ["event", "list", "-n", "1", "--json"]).output)
    assert event["kind"] == "repository.changed"
    assert event["recorded_by"]["name"] == "laptop"
    subject = event["subject"]["id"]
    assert event["subject"] == {
        "id": subject,
        "type": "repository",
        "name": "project",
        "path": None,
    }
    assert event["repository"] == {"id": subject, "name": "project"}
    assert event["details"] == [{"field": "name", "text": "proj → project"}]
    assert event["priority"] == 20
    assert event["summary"] == "name: proj → project"
    assert event["payload"] == {"name": {"old": "proj", "new": "project"}}
    assert datetime.fromisoformat(event["recorded_at"]) <= datetime.now(UTC)

    shown = json.loads(runner.invoke(app, ["event", "show", event["id"], "--json"]).output)
    assert shown == event


def test_kinds() -> None:
    lines = runner.invoke(app, ["event", "kinds"]).output.splitlines()
    assert lines[0].split() == ["kind", "priority"]
    assert [line.split() for line in lines[1:]] == [
        [kind.value, kind.default_priority.name.lower()] for kind in EventKind
    ]
    listed = json.loads(runner.invoke(app, ["event", "kinds", "--json"]).output)
    assert {"kind": "clone.missing", "priority": Priority.HIGH} in listed
    assert len(listed) == len(EventKind)


def test_priority_names_match() -> None:
    assert get_args(PriorityName) == tuple(priority.name.lower() for priority in Priority)


def test_list_shortens_long_summaries() -> None:
    name = "a-repository-name-long-enough-to-need-shortening"
    runner.invoke(app, ["repo", "rename", "project", name])
    line = runner.invoke(app, ["event", "list", "-n", "1"]).output.splitlines()[1]
    summary = re.split(r"\s{2,}", line)[-1]
    assert summary == f"name: project → {name}"[: SUMMARY_WIDTH - 1] + "…"
