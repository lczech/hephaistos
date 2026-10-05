import dataclasses
import json
import re
import sqlite3
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from pathlib import PurePath
from typing import Any, Self

from hephaistos.core.db.sessions import ReadSession, WriteSession
from hephaistos.core.events.kinds import EventKind, Priority
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.ids import Timestamp, new_id


def _encode(value: object) -> object:
    """JSON encoding for the types our payloads contain beyond JSON's own."""
    if isinstance(value, uuid.UUID | PurePath):
        return str(value)
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


def record(
    session: WriteSession,
    kind: EventKind,
    subject: uuid.UUID,
    payload: object,
    priority: Priority | None = None,
) -> uuid.UUID:
    """Records an Event about `subject` in the session's transaction; returns its ID."""
    event_id = new_id()
    session.conn.execute(
        "INSERT INTO events (id, recorded_at, recorded_by, kind, subject, priority, payload)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            event_id,
            session.tick(),
            session.machine_id,
            kind,
            subject,
            priority or kind.default_priority,
            to_json(payload),
        ),
    )
    return event_id


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
        )


_COLUMNS = "id, recorded_at, recorded_by, kind, subject, priority, payload"
_GLOB_CHARACTERS = re.compile(r"[*?\[]")


def _kind_condition(pattern: str) -> tuple[str, list[object]]:
    """SQL matching one `--kind`: a glob if it has glob characters, else whole leading parts."""
    if _GLOB_CHARACTERS.search(pattern):
        return "kind GLOB ?", [pattern]
    return "(kind = ? OR substr(kind, 1, ?) = ?)", [pattern, len(pattern) + 1, f"{pattern}."]


def recent(  # noqa: PLR0913 - one keyword argument per filter
    session: ReadSession,
    *,
    limit: int | None = None,
    kinds: Sequence[str] = (),
    min_priority: int | None = None,
    recorded_by: uuid.UUID | None = None,
    since: datetime | None = None,
) -> list[Event]:
    """The Events matching all given filters, newest first; `kinds` match if any one does.

    A kind like `clone` matches `clone.added` but not `clones.added`; `*.deleted` is a glob.
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
    if recorded_by is not None:
        conditions.append("recorded_by = ?")
        parameters.append(recorded_by)
    if since is not None:
        conditions.append("recorded_at >= ?")
        parameters.append(Timestamp.of(int(since.timestamp() * 1000)))
    where = f" WHERE {' AND '.join(conditions)}" if conditions else ""
    rows = session.conn.execute(
        f"SELECT {_COLUMNS} FROM events{where} ORDER BY recorded_at DESC LIMIT ?",  # noqa: S608 - our own conditions; values are parameters
        (*parameters, -1 if limit is None else limit),
    )
    return [Event.from_row(row) for row in rows]


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
