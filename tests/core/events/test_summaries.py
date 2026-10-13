import dataclasses
import json
from pathlib import Path

import pytest

from hephaistos.core.events import summaries
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
from hephaistos.core.utils.ids import Timestamp, new_id

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
    return summaries.summary(event)


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


def test_summary_is_whole() -> None:
    subject = "A subject longer than any table column. " * 5
    committed = dataclasses.replace(COMMITTED, subject=subject, how="commit")
    assert _summary(EventKind.CLONE_COMMITTED, committed) == f"bbbbbbb {subject}"
