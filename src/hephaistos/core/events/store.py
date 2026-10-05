import dataclasses
import json
import uuid
from pathlib import PurePath
from typing import TYPE_CHECKING

from hephaistos.core.db.sessions import WriteSession
from hephaistos.core.events.kinds import EventKind, Priority
from hephaistos.core.utils.ids import new_id

if TYPE_CHECKING:
    from _typeshed import DataclassInstance


def _encode(value: object) -> object:
    """JSON encoding for the types our payloads contain beyond JSON's own."""
    if isinstance(value, uuid.UUID | PurePath):
        return str(value)
    raise TypeError(f"cannot encode {type(value).__name__} in an Event payload")


def to_json(payload: "DataclassInstance") -> str:
    """A payload dataclass as JSON text, with sorted keys."""
    return json.dumps(dataclasses.asdict(payload), default=_encode, sort_keys=True)


def record(
    session: WriteSession,
    kind: EventKind,
    subject: uuid.UUID,
    payload: "DataclassInstance",
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
