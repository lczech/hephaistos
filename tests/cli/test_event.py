import dataclasses
import json
import re
import socket
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import get_args

import pytest
import typer
from typer.testing import CliRunner

from hephaistos.cli.event import PriorityName, parse_since, summary_text
from hephaistos.cli.main import app
from hephaistos.core.db.sessions import write_session
from hephaistos.core.events import events
from hephaistos.core.events.events import Change, Event, to_json
from hephaistos.core.events.kinds import EventKind, Priority
from hephaistos.core.registry.clones import Clone
from hephaistos.core.registry.filesystems import Filesystem
from hephaistos.core.registry.machines import Machine
from hephaistos.core.registry.mounts import Mount
from hephaistos.core.registry.repositories import Repository
from hephaistos.core.state.activity import (
    ActivityPayload,
    CommittedPayload,
    HeadMovedPayload,
    MergedPayload,
    PulledPayload,
    PushedPayload,
    RebasedPayload,
    ResetPayload,
    SwitchedPayload,
)
from hephaistos.core.state.checkouts import Failed
from hephaistos.core.state.clones import BranchPayload, CreatedPayload, RenamedPayload
from hephaistos.core.state.worktrees import (
    FailedPayload,
    ListedPayload,
    MovedPayload,
    WorktreePayload,
)
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.ids import Timestamp, new_id
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


def test_show_a_payload_that_isnt_an_object(paths: Paths) -> None:
    with write_session(paths) as session:
        recorded = events.record(session, EventKind.CLONE_FAILED, ID, ["not", "an", "object"])
    result = runner.invoke(app, ["event", "show", str(recorded.id)])
    assert result.exit_code == 0, result.output
    assert result.output.splitlines()[-1].split(maxsplit=1) == [
        "payload",
        '["not", "an", "object"]',
    ]


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


ID = new_id()
OLD, NEW = "a" * 40, "b" * 40
HEAD = Change(OLD, NEW)


def _in_worktree(payload: ActivityPayload) -> dict[str, object]:
    """An activity payload as a Worktree's Event has it: with its Clone."""
    return {"clone_id": ID, **dataclasses.asdict(payload)}


COMMITTED = CommittedPayload(HEAD, "Fix", "amend", OLD)
MERGED = MergedPayload(HEAD, "feature", fast_forward=True)
PULLED = PulledPayload(HEAD, "rebase", "--rebase")
REBASED = RebasedPayload(HEAD, OLD, 3, "feature")
RESET = ResetPayload(HEAD, "HEAD~1")
SWITCHED = SwitchedPayload(HEAD, Change("main", "feature"))
HEAD_MOVED = HeadMovedPayload(HEAD, "clone: from /src")
WORKTREE = WorktreePayload(ID, Path("/w"))

# Payloads as the code that records them builds them, with their summaries.
SUMMARIES: dict[EventKind, tuple[object, str]] = {
    EventKind.MACHINE_ADDED: (
        Machine(id=ID, name="m", hostname="m.lan", os_machine_id=None),
        "m.lan",
    ),
    EventKind.FILESYSTEM_ADDED: (Filesystem(id=ID, name="m-local"), ""),
    EventKind.MOUNT_ADDED: (Mount(id=ID, machine_id=ID, filesystem_id=ID, path=Path("/")), "/"),
    EventKind.REPOSITORY_ADDED: (Repository(id=ID, name="proj"), ""),
    EventKind.REPOSITORY_CHANGED: ({"name": Change("proj", "project")}, "name: proj → project"),
    EventKind.REPOSITORY_DELETED: (Repository(id=ID, name="proj"), ""),
    EventKind.CLONE_ADDED: (
        Clone(
            id=ID,
            repository_id=ID,
            filesystem_id=ID,
            resolved_path=Path("/r"),
            display_path=Path("/r"),
        ),
        "",
    ),
    EventKind.CLONE_DELETED: ({}, ""),
    EventKind.CLONE_MOVED: (
        {
            "display_path": Change(Path("/a/r"), Path("/b/r")),
            "resolved_path": Change(Path("/a/r"), Path("/b/r")),
        },
        "/a/r → /b/r",
    ),
    EventKind.CLONE_MISSING: ({}, ""),
    EventKind.CLONE_FOUND: ({}, ""),
    EventKind.CLONE_FAILED: (Failed("timed out"), "timed out"),
    EventKind.CLONE_RECOVERED: ({}, ""),
    EventKind.CLONE_BRANCH_CREATED: (CreatedPayload("feature", OLD), "feature from aaaaaaa"),
    EventKind.CLONE_BRANCH_DELETED: (BranchPayload("feature"), "feature"),
    EventKind.CLONE_REMOTES_CHANGED: (
        {"origin": Change(None, "git@host:a/b")},
        "origin: null → git@host:a/b",
    ),
    EventKind.CLONE_BRANCH_RENAMED: (RenamedPayload(Change("old", "new")), "old → new"),
    EventKind.CLONE_COMMITTED: (COMMITTED, "bbbbbbb Fix (amend)"),
    EventKind.CLONE_MERGED: (MERGED, "feature (fast-forward)"),
    EventKind.CLONE_PULLED: (PULLED, "rebase to bbbbbbb"),
    EventKind.CLONE_REBASED: (REBASED, "3 commits onto aaaaaaa"),
    EventKind.CLONE_RESET: (RESET, "to HEAD~1"),
    EventKind.CLONE_BRANCH_SWITCHED: (SWITCHED, "main → feature"),
    EventKind.CLONE_HEAD_MOVED: (HEAD_MOVED, "clone: from /src"),
    EventKind.CLONE_PUSHED: (PushedPayload("origin/main", HEAD), "origin/main bbbbbbb"),
    EventKind.WORKTREE_ADDED: (ListedPayload(ID, Path("/w"), "feature"), "feature"),
    EventKind.WORKTREE_REMOVED: (ListedPayload(ID, Path("/w"), None), "(detached)"),
    EventKind.WORKTREE_RESTORED: (ListedPayload(ID, Path("/w"), "feature"), "feature"),
    EventKind.WORKTREE_MOVED: (MovedPayload(ID, Change(Path("/a"), Path("/b"))), "/a → /b"),
    EventKind.WORKTREE_MISSING: (WORKTREE, ""),
    EventKind.WORKTREE_FOUND: (WORKTREE, ""),
    EventKind.WORKTREE_FAILED: (FailedPayload(ID, Path("/w"), "timed out"), "timed out"),
    EventKind.WORKTREE_RECOVERED: (WORKTREE, ""),
    EventKind.WORKTREE_COMMITTED: (_in_worktree(COMMITTED), "bbbbbbb Fix (amend)"),
    EventKind.WORKTREE_MERGED: (_in_worktree(MERGED), "feature (fast-forward)"),
    EventKind.WORKTREE_PULLED: (_in_worktree(PULLED), "rebase to bbbbbbb"),
    EventKind.WORKTREE_REBASED: (_in_worktree(REBASED), "3 commits onto aaaaaaa"),
    EventKind.WORKTREE_RESET: (_in_worktree(RESET), "to HEAD~1"),
    EventKind.WORKTREE_BRANCH_SWITCHED: (_in_worktree(SWITCHED), "main → feature"),
    EventKind.WORKTREE_HEAD_MOVED: (_in_worktree(HEAD_MOVED), "clone: from /src"),
}


def _summary(kind: str, payload: object) -> str:
    """The summary of an Event with this payload, stored and read back as JSON."""
    event = Event(
        id=new_id(),
        recorded_at=Timestamp(0),
        recorded_by=ID,
        kind=kind,
        subject=ID,
        priority=Priority.NORMAL,
        payload=json.loads(to_json(payload)),
    )
    return summary_text(event)


def test_every_kind_has_a_summary() -> None:
    assert set(SUMMARIES) == set(EventKind)


@pytest.mark.parametrize(("kind", "payload", "expected"), [(k, *v) for k, v in SUMMARIES.items()])
def test_summary(kind: EventKind, payload: object, expected: str) -> None:
    assert _summary(kind, payload) == expected


@pytest.mark.parametrize(
    ("kind", "payload", "expected"),
    [
        (
            EventKind.CLONE_COMMITTED,
            {"head": {"old": None, "new": NEW}, "how": "commit"},
            "bbbbbbb ?",
        ),
        (EventKind.CLONE_COMMITTED, {"head": NEW, "subject": "Fix", "how": "commit"}, "? Fix"),
        (EventKind.CLONE_FAILED, {"error": {"code": 1}}, '{"code": 1}'),
        (EventKind.CLONE_REBASED, {"commits": "three", "onto": None}, "three commits"),
        (EventKind.WORKTREE_MOVED, {"path": "/w"}, "? → ?"),
        (EventKind.CLONE_BRANCH_DELETED, ["feature"], '["feature"]'),
        ("clone.from_a_newer_version", {"x": 1}, ""),
    ],
)
def test_summary_of_a_payload_that_doesnt_fit(kind: str, payload: object, expected: str) -> None:
    assert _summary(kind, payload) == expected
