import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest

from hephaistos.core.db.sessions import ReadSession, read_session, write_session
from hephaistos.core.events import events
from hephaistos.core.events.events import Event
from hephaistos.core.events.kinds import EventKind, Priority
from hephaistos.core.registry import machines
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.ids import Timestamp, new_id
from hephaistos.core.utils.paths import Paths

SETUP_KINDS = ["mount.added", "filesystem.added", "machine.added"]


@pytest.fixture
def set_up(paths: Paths) -> Paths:
    """A Machine whose setup recorded the SETUP_KINDS."""
    machines.set_up(paths, "laptop")
    return paths


@pytest.fixture
def session(set_up: Paths) -> Iterator[ReadSession]:
    """A read session; each query sees what was committed before it."""
    with read_session(set_up) as session:
        yield session


def _insert(paths: Paths, kind: str, event_id: uuid.UUID | None = None, priority: int = 20) -> None:
    """An Event as a Peer might send it, kind and priority unchecked."""
    with write_session(paths) as session:
        session.conn.execute(
            "INSERT INTO events VALUES (?, ?, ?, ?, ?, ?, '{}')",
            (event_id or new_id(), session.tick(), session.machine_id, kind, new_id(), priority),
        )


def _kinds(events: list[Event]) -> list[str]:
    return [event.kind for event in events]


def test_newest_first_with_limit(session: ReadSession) -> None:
    assert _kinds(events.recent(session)) == SETUP_KINDS
    assert _kinds(events.recent(session, limit=2)) == SETUP_KINDS[:2]


def test_read_back(set_up: Paths, session: ReadSession) -> None:
    subject = new_id()
    with write_session(set_up) as writing:
        recorded = events.record(
            writing, EventKind.REPOSITORY_ADDED, subject, {"name": "proj"}, Priority.HIGH
        )
    [event] = events.recent(session, limit=1)
    assert event == recorded
    assert event.recorded_by == session.machine_id
    assert isinstance(event.recorded_at, Timestamp)
    assert (event.kind, event.subject_type, event.subject) == (
        "repository.added",
        "repository",
        subject,
    )
    assert event.priority == Priority.HIGH
    assert event.payload == {"name": "proj"}


def test_kind_prefix_matches_whole_parts(set_up: Paths, session: ReadSession) -> None:
    _insert(set_up, "machines.renamed")
    assert _kinds(events.recent(session, kinds=["machine"])) == ["machine.added"]
    assert _kinds(events.recent(session, kinds=["machine.added"])) == ["machine.added"]
    assert _kinds(events.recent(session, kinds=["machine", "mount"])) == [
        "mount.added",
        "machine.added",
    ]


def test_kind_glob(set_up: Paths, session: ReadSession) -> None:
    _insert(set_up, "clone.deleted")
    assert _kinds(events.recent(session, kinds=["*.added"])) == SETUP_KINDS
    assert _kinds(events.recent(session, kinds=["clone.*", "m?chine.*"])) == [
        "clone.deleted",
        "machine.added",
    ]


def test_min_priority(set_up: Paths, session: ReadSession) -> None:
    _insert(set_up, "agent.waiting", priority=Priority.HIGH)
    _insert(set_up, "agent.failed", priority=Priority.URGENT)
    _insert(set_up, "agent.unknown", priority=35)
    assert _kinds(events.recent(session, min_priority=Priority.HIGH)) == [
        "agent.unknown",
        "agent.failed",
        "agent.waiting",
    ]


def test_recorded_by(session: ReadSession) -> None:
    assert _kinds(events.recent(session, recorded_by=session.machine_id)) == SETUP_KINDS
    assert events.recent(session, recorded_by=new_id()) == []


def test_since(session: ReadSession) -> None:
    now = datetime.now(UTC)
    assert _kinds(events.recent(session, since=now - timedelta(minutes=1))) == SETUP_KINDS
    assert events.recent(session, since=now + timedelta(minutes=1)) == []


def test_by_short_id(set_up: Paths, session: ReadSession) -> None:
    first = uuid.UUID("01999999-0000-7000-8000-0000000000ab")
    second = uuid.UUID("01999999-0000-7000-8000-0000000001ab")
    _insert(set_up, "test.first", first)
    _insert(set_up, "test.second", second)
    assert events.by_short_id(session, "00ab").id == first
    assert events.by_short_id(session, "01AB").id == second
    assert events.by_short_id(session, str(first)).id == first
    with pytest.raises(HephaistosError, match="several"):
        events.by_short_id(session, "ab")
    with pytest.raises(HephaistosError, match="no Event"):
        events.by_short_id(session, "0cab")
    with pytest.raises(HephaistosError, match="not an Event ID"):
        events.by_short_id(session, "xyz")
