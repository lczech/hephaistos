import uuid
from datetime import UTC, datetime, timedelta

import pytest

from hephaistos.core.events.events import Change
from hephaistos.core.state import activity
from hephaistos.core.state.activity import (
    BEGINNING,
    Activity,
    ActivityKind,
    CommittedPayload,
    Cursor,
    HeadMovedPayload,
    MergedPayload,
    PulledPayload,
    RebasedPayload,
    ResetPayload,
    SwitchedPayload,
)
from hephaistos.core.utils.git import ReflogEntry

AT = datetime(2026, 10, 7, 12, tzinfo=UTC)


def _entries(*moves: tuple[str, str], ref: str = "HEAD") -> list[ReflogEntry]:
    """Entries, oldest first, of HEAD moving to each commit with each message, a second apart."""
    entries: list[ReflogEntry] = []
    old = None
    for index, (new, message) in enumerate(moves):
        entries.append(ReflogEntry(ref, old, new, AT + timedelta(seconds=index), message))
        old = new
    return entries


def _kinds(found: list[Activity]) -> list[ActivityKind]:
    return [done.kind for done in found]


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        ("commit: Fix", CommittedPayload(Change("a", "b"), "Fix", "commit", None)),
        (
            "commit (initial): First",
            CommittedPayload(Change("a", "b"), "First", "initial", None),
        ),
        ("commit (amend): Fix", CommittedPayload(Change("a", "b"), "Fix", "amend", "a")),
        ("cherry-pick: Fix", CommittedPayload(Change("a", "b"), "Fix", "cherry-pick", None)),
        (
            'revert: Revert "Fix"',
            CommittedPayload(Change("a", "b"), 'Revert "Fix"', "revert", None),
        ),
        ("am: Patch", CommittedPayload(Change("a", "b"), "Patch", "am", None)),
        ("commit (merge): Merge x", MergedPayload(Change("a", "b"), None, fast_forward=False)),
        (
            "merge feature: Fast-forward",
            MergedPayload(Change("a", "b"), "feature", fast_forward=True),
        ),
        (
            "merge feature: Merge made by the 'ort' strategy.",
            MergedPayload(Change("a", "b"), "feature", fast_forward=False),
        ),
        ("pull: Fast-forward", PulledPayload(Change("a", "b"), "fast-forward", "")),
        (
            "pull -q origin main: Merge made by the 'ort' strategy.",
            PulledPayload(Change("a", "b"), "merge", "-q origin main"),
        ),
        ("reset: moving to HEAD~1", ResetPayload(Change("a", "b"), "HEAD~1")),
        (
            "checkout: moving from main to feature",
            SwitchedPayload(Change("a", "b"), Change("main", "feature")),
        ),
        ("clone: from /src", HeadMovedPayload(Change("a", "b"), "clone: from /src")),
    ],
)
def test_single_entries(message: str, expected: object) -> None:
    entry = ReflogEntry("HEAD", "a", "b", AT, message)
    [found] = activity.activities([entry], rebasing=False)[0]
    assert (found.occurred_at, found.payload) == (AT, expected)


@pytest.mark.parametrize(
    ("old", "message"),
    [
        ("b", "reset: moving to HEAD"),  # by `git stash`
        ("a", "Branch: renamed refs/heads/x to refs/heads/y"),
        (None, ""),  # a new Worktree
    ],
)
def test_skipped_entries(old: str | None, message: str) -> None:
    entry = ReflogEntry("HEAD", old, "b", AT, message)
    assert activity.activities([entry], rebasing=False) == ([], 1)


def test_rebase_folds_into_one() -> None:
    entries = _entries(
        ("base", "commit: Base"),
        ("onto", "rebase (start): checkout main"),
        ("p1", "rebase (pick): One"),
        ("p2", "rebase (pick): Two"),
        ("p3", "rebase (continue): Three"),
        ("p3", "rebase (finish): returning to refs/heads/feature"),
        ("x", "commit: After"),
    )
    found, count = activity.activities(entries[1:], rebasing=False)
    assert count == len(entries) - 1
    assert _kinds(found) == [ActivityKind.REBASED, ActivityKind.COMMITTED]
    assert found[0].occurred_at == entries[5].at
    assert found[0].payload == RebasedPayload(Change("base", "p3"), "onto", 3, "feature")


def test_pull_with_rebase_is_a_pull() -> None:
    entries = _entries(
        ("base", "commit: Base"),
        ("onto", "pull --rebase (start): checkout abc"),
        ("p1", "pull --rebase (pick): Mine"),
        ("p1", "pull --rebase (finish): returning to refs/heads/main"),
    )
    [found] = activity.activities(entries[1:], rebasing=False)[0]
    assert found.occurred_at == entries[3].at
    assert found.payload == PulledPayload(Change("base", "p1"), "rebase", "--rebase")


def test_rebase_without_movement_is_skipped_and_an_abort_that_moved_is_kept() -> None:
    noop = _entries(
        ("base", "commit: Base"),
        ("base", "rebase (start): checkout main"),
        ("base", "rebase (finish): returning to refs/heads/main"),
    )
    assert activity.activities(noop[1:], rebasing=False) == ([], 2)
    aborted = _entries(
        ("base", "commit: Base"),
        ("onto", "rebase (start): checkout main"),
        ("p1", "rebase (pick): One"),
        ("base", "rebase (abort): returning to refs/heads/main"),
    )
    assert activity.activities(aborted[1:], rebasing=False) == ([], 3)
    moved = [*aborted[1:3], ReflogEntry("HEAD", "p1", "p1", AT, "rebase (abort): returning")]
    assert _kinds(activity.activities(moved, rebasing=False)[0]) == [ActivityKind.HEAD_MOVED]


def test_unfinished_rebase_waits_while_in_progress() -> None:
    entries = _entries(
        ("base", "commit: Base"),
        ("onto", "rebase (start): checkout main"),
        ("p1", "rebase (pick): One"),
    )
    found, count = activity.activities(entries, rebasing=True)
    assert (_kinds(found), count) == ([ActivityKind.COMMITTED], 1)
    found, count = activity.activities(entries, rebasing=False)
    assert (_kinds(found), count) == ([ActivityKind.COMMITTED, ActivityKind.REBASED], 3)
    assert found[1].payload.head == Change("base", "p1")


def test_cursor() -> None:
    entries = _entries(("a", "commit: A"), ("b", "commit: B"), ("c", "commit: C"))[::-1]
    after_a = activity.cursor_after(entries[2])
    assert Cursor.from_text(after_a.to_text()) == after_a
    assert activity.unread(entries, after_a) == entries[1::-1]
    assert activity.unread(entries, activity.end(entries)) == []
    assert activity.unread(entries, BEGINNING) is None
    assert activity.newer(entries, BEGINNING) == entries[::-1]
    lost = Cursor(int(entries[2].at.timestamp()), "expired")
    assert activity.newer(entries, lost) == entries[1::-1]
    assert activity.end([]) == BEGINNING


def test_pushes_skip_fetches() -> None:
    entries = _entries(
        ("a", "fetch: fast-forward"),
        ("b", "update by push"),
        ref="refs/remotes/origin/main",
    )
    [pushed] = activity.pushes(entries)
    assert pushed.occurred_at == entries[1].at
    assert (pushed.payload.branch, pushed.payload.commit) == ("origin/main", Change("a", "b"))


def test_branch_origin() -> None:
    created = _entries(("a", "branch: Created from HEAD"), ("b", "commit: B"))[::-1]
    origin = activity.branch_origin("feature", created)
    assert (origin.created_at, origin.start, origin.renamed_from) == (AT, "a", None)
    renamed = [
        ReflogEntry("refs/heads/y", "b", "b", AT, "Branch: renamed refs/heads/x to refs/heads/y")
    ]
    assert activity.branch_origin("y", [*renamed, *created]).renamed_from == "x"
    assert activity.branch_origin("x", []) == activity.UNKNOWN_ORIGIN


def test_key_tells_apart_where_and_what() -> None:
    clone_id = uuid.UUID(int=1)
    head = Change("a", "b")
    key = activity.key(clone_id, "", "HEAD", AT, head)
    assert len(key) == 16
    assert key == activity.key(clone_id, "", "HEAD", AT, Change("a", "b"))
    assert key != activity.key(clone_id, "feature", "HEAD", AT, head)
    assert key != activity.key(clone_id, "", "HEAD", AT, Change(None, "b"))
