import dataclasses
import json
import re
import sqlite3
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import PurePath
from typing import Any, Self

from hephaistos.core.db import values
from hephaistos.core.db.sessions import ReadSession, WriteSession
from hephaistos.core.db.values import Decoder
from hephaistos.core.events.kinds import EventKind, Priority
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.ids import Timestamp, new_id

#: The columns of `events`, decoded for raw listings.
DECODERS: dict[str, Decoder] = {
    "id": values.uuid_bytes,
    "recorded_at": values.clock,
    "recorded_by": values.uuid_bytes,
    "kind": values.plain,
    "subject": values.uuid_bytes,
    "priority": values.plain,
    "payload": values.json_text,
    "occurred_at": values.milliseconds,
    "key": values.hex_bytes,
}


def _encode(value: object) -> object:
    """JSON encoding for the types our payloads contain beyond JSON's own."""
    if isinstance(value, uuid.UUID | PurePath):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return {field.name: getattr(value, field.name) for field in dataclasses.fields(value)}
    raise TypeError(f"cannot encode {type(value).__name__} in an Event payload")


def to_json(payload: object) -> str:
    """A payload (a dataclass, or a dict of them and plain values) as JSON text, keys sorted."""
    return json.dumps(payload, default=_encode, sort_keys=True)


@dataclass(frozen=True)
class Change:
    """One field of a `.changed` Event's payload."""

    old: object
    new: object


@dataclass(frozen=True)
class Event:
    """Something that happened."""

    id: uuid.UUID
    recorded_at: Timestamp
    recorded_by: uuid.UUID
    kind: str  # not an EventKind: kinds from newer Peers are kept as they are
    subject: uuid.UUID
    priority: int
    payload: dict[str, Any]
    occurred_at: datetime | None = None  # when it happened, by its source; None if unknown
    key: bytes | None = None  # identifies the same fact from several Machines, for deduplication

    @property
    def subject_type(self) -> str:
        """The type of thing the Event is about, from its kind: `clone` for `clone.added`."""
        return self.kind.partition(".")[0]

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> Self:
        """Builds an Event from a database row with its columns."""
        return cls(
            id=uuid.UUID(bytes=row["id"]),
            recorded_at=Timestamp(row["recorded_at"]),
            recorded_by=uuid.UUID(bytes=row["recorded_by"]),
            kind=row["kind"],
            subject=uuid.UUID(bytes=row["subject"]),
            priority=row["priority"],
            payload=json.loads(row["payload"]),
            occurred_at=None
            if row["occurred_at"] is None
            else datetime.fromtimestamp(row["occurred_at"] / 1000, UTC),
            key=row["key"],
        )


@dataclass(frozen=True)
class Caused:
    """An Event that a change causes, before it is recorded about its subject."""

    kind: EventKind
    payload: object
    occurred_at: datetime | None = None
    key: bytes | None = None


def record(  # noqa: PLR0913 - the optional ones are keyword-only
    session: WriteSession,
    kind: EventKind,
    subject: uuid.UUID,
    payload: object,
    *,
    priority: Priority | None = None,
    occurred_at: datetime | None = None,
    key: bytes | None = None,
) -> Event:
    """Records an Event about `subject` in the session's transaction, and returns it."""
    text = to_json(payload)
    event = Event(
        id=new_id(),
        recorded_at=session.tick(),
        recorded_by=session.machine_id,
        kind=kind,
        subject=subject,
        priority=priority or kind.default_priority,
        payload=json.loads(text),
        occurred_at=occurred_at,
        key=key,
    )
    session.conn.execute(
        "INSERT INTO events"
        " (id, recorded_at, recorded_by, kind, subject, priority, payload, occurred_at, key)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            event.id,
            event.recorded_at,
            event.recorded_by,
            event.kind,
            event.subject,
            event.priority,
            text,
            None if occurred_at is None else round(occurred_at.timestamp() * 1000),
            event.key,
        ),
    )
    session.recorded.append((event.kind, event.id, event.subject))
    return event


_COLUMNS = "id, recorded_at, recorded_by, kind, subject, priority, payload, occurred_at, key"
_GLOB_CHARACTERS = re.compile(r"[*?\[]")


def _kind_condition(pattern: str) -> tuple[str, list[object]]:
    """SQL matching one `--kind`: a glob if it has glob characters, else whole leading parts."""
    if _GLOB_CHARACTERS.search(pattern):
        return "kind GLOB ?", [pattern]
    return "(kind = ? OR substr(kind, 1, ?) = ?)", [pattern, len(pattern) + 1, f"{pattern}."]


def _marks(values: Sequence[object]) -> str:
    """SQL placeholders for these values: `?, ?, ?`."""
    return ", ".join("?" * len(values))


def recent(  # noqa: PLR0913 - one keyword argument per filter
    session: ReadSession,
    *,
    limit: int | None = None,
    kinds: Sequence[str] = (),
    min_priority: int | None = None,
    recorded_by: Sequence[uuid.UUID] = (),
    since: datetime | None = None,
    repository_ids: Sequence[uuid.UUID] = (),
    clone_id: uuid.UUID | None = None,
    worktree_id: uuid.UUID | None = None,
    before: uuid.UUID | None = None,
) -> list[Event]:
    """The Events matching all given filters, newest first.

    Of `kinds`, `recorded_by` (Machines) and `repository_ids`, any one has to match.

    `before` pages back: only Events older than that one, which must exist.

    A kind like `clone` matches `clone.added` but not `clones.added`; `*.deleted` is a glob.
    Events about a Repository include those about its Clones, and those about a Clone those
    about its Worktrees.
    """
    conditions: list[str] = []
    parameters: list[object] = []
    if kinds:
        matched = [_kind_condition(pattern) for pattern in kinds]
        conditions.append("(" + " OR ".join(condition for condition, _ in matched) + ")")
        parameters += [value for _, values in matched for value in values]
    if min_priority is not None:
        conditions.append("priority >= ?")
        parameters.append(min_priority)
    if recorded_by:
        conditions.append(f"recorded_by IN ({_marks(recorded_by)})")
        parameters += recorded_by
    if since is not None:
        conditions.append("recorded_at >= ?")
        parameters.append(Timestamp.of(int(since.timestamp() * 1000)))
    if repository_ids:
        marks = _marks(repository_ids)
        conditions.append(
            f"(subject IN ({marks})"  # noqa: S608 - only placeholders; values are parameters
            f" OR subject IN (SELECT id FROM registry_clones WHERE repository_id IN ({marks}))"
            " OR subject IN (SELECT w.id FROM state_worktrees w"
            f" JOIN registry_clones c ON c.id = w.clone_id WHERE c.repository_id IN ({marks})))"
        )
        parameters += [*repository_ids] * 3
    if clone_id is not None:
        conditions.append(
            "(subject = ? OR subject IN (SELECT id FROM state_worktrees WHERE clone_id = ?))"
        )
        parameters += [clone_id] * 2
    if worktree_id is not None:
        conditions.append("subject = ?")
        parameters.append(worktree_id)
    if before is not None:
        if get(session, before) is None:
            raise HephaistosError(f"no Event with ID {before}")
        conditions.append("(recorded_at, id) < (SELECT recorded_at, id FROM events WHERE id = ?)")
        parameters.append(before)
    where = f" WHERE {' AND '.join(conditions)}" if conditions else ""
    rows = session.conn.execute(
        f"SELECT {_COLUMNS} FROM events{where} ORDER BY recorded_at DESC, id DESC LIMIT ?",  # noqa: S608 - our own conditions; values are parameters
        (*parameters, -1 if limit is None else limit),
    )
    return [Event.from_row(row) for row in rows]


def get(session: ReadSession, event_id: uuid.UUID) -> Event | None:
    """The Event with this ID; None if there is none."""
    row = session.conn.execute(
        f"SELECT {_COLUMNS} FROM events WHERE id = ?",  # noqa: S608 - our own constant
        (event_id,),
    ).fetchone()
    return None if row is None else Event.from_row(row)


def by_short_id(session: ReadSession, short: str) -> Event:
    """The Event whose ID ends with `short` (hex, dashes ignored); it must be the only one."""
    suffix = short.replace("-", "").lower()
    if not suffix or not re.fullmatch(r"[0-9a-f]{1,32}", suffix):
        raise HephaistosError(f"not an Event ID: {short}")
    rows = session.conn.execute(
        f"SELECT {_COLUMNS} FROM events WHERE lower(hex(id)) LIKE ? LIMIT 2",  # noqa: S608 - our own constant
        (f"%{suffix}",),
    ).fetchall()
    if not rows:
        raise HephaistosError(f"no Event with an ID ending in {suffix}")
    if len(rows) > 1:
        raise HephaistosError(f"several Events have IDs ending in {suffix}; give more of it")
    return Event.from_row(rows[0])
