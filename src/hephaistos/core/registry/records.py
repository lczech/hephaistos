"""Rules shared by all Registry tables: modified_at/by on every write, and a change Event."""

import dataclasses
import uuid

from hephaistos.core.db.sessions import WriteSession
from hephaistos.core.db.tables import Category, Table
from hephaistos.core.events import store
from hephaistos.core.events.kinds import EventKind


@dataclasses.dataclass(frozen=True, kw_only=True)
class Record:
    """Base of all Registry records: everything has a UUIDv7."""

    id: uuid.UUID


def add(session: WriteSession, table: Table, kind: EventKind, record: Record) -> None:
    """Inserts a new Registry record and records `kind` with its values."""
    if table.category is not Category.REGISTRY:
        raise ValueError(f"{table} is not a Registry table")
    values = {field.name: getattr(record, field.name) for field in dataclasses.fields(record)}
    values |= {"modified_at": session.tick(), "modified_by": session.machine_id}
    columns = ", ".join(values)
    placeholders = ", ".join("?" * len(values))
    # Table and column names come from our Table enum and dataclass fields, never from input.
    session.conn.execute(
        f"INSERT INTO {table} ({columns}) VALUES ({placeholders})",  # noqa: S608
        tuple(values.values()),
    )
    store.record(session, kind, record.id, record)
