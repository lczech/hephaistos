"""Rules shared by all Registry tables: modified_at/by on every write, and a change Event."""

import dataclasses
import uuid
from collections.abc import Collection

from hephaistos.core.db import values
from hephaistos.core.db.sessions import ReadSession, WriteSession, chunks
from hephaistos.core.db.tables import Category, Table
from hephaistos.core.db.values import Decoder
from hephaistos.core.events import events
from hephaistos.core.events.kinds import EventKind

#: The columns all Registry tables end with, decoded for raw views.
DECODERS: dict[str, Decoder] = {
    "id": values.uuid_bytes,
    "modified_at": values.clock,
    "modified_by": values.uuid_bytes,
    "deleted": values.plain,
}


@dataclasses.dataclass(frozen=True, kw_only=True)
class Record:
    """Base of all Registry records: everything has a UUIDv7."""

    id: uuid.UUID


def _check(table: Table) -> None:
    """Raises ValueError unless `table` is a Registry table."""
    if table.category is not Category.REGISTRY:
        raise ValueError(f"{table} is not a Registry table")


def _values(session: WriteSession, record: Record) -> dict[str, object]:
    """The record's fields with the modification columns, by column name."""
    values: dict[str, object] = {
        field.name: getattr(record, field.name) for field in dataclasses.fields(record)
    }
    return values | {"modified_at": session.tick(), "modified_by": session.machine_id}


def add(session: WriteSession, table: Table, kind: EventKind, record: Record) -> None:
    """Inserts a new Registry record and records `kind` with its values."""
    _check(table)
    values = _values(session, record)
    columns = ", ".join(values)
    placeholders = ", ".join("?" * len(values))
    session.conn.execute(
        f"INSERT INTO {table} ({columns}) VALUES ({placeholders})",  # noqa: S608 - table and columns come from our Table enum and dataclass fields
        tuple(values.values()),
    )
    events.record(session, kind, record.id, record)


def change(session: WriteSession, table: Table, kind: EventKind, old: Record, new: Record) -> None:
    """Replaces a Registry record's values; records `kind` with the changed fields, if any."""
    _check(table)
    if old.id != new.id or type(old) is not type(new):
        raise ValueError("old and new must be the same record")
    changes = {
        field.name: events.Change(getattr(old, field.name), getattr(new, field.name))
        for field in dataclasses.fields(new)
        if getattr(old, field.name) != getattr(new, field.name)
    }
    if not changes:
        return
    values = _values(session, new)
    assignments = ", ".join(f"{column} = ?" for column in values)
    cursor = session.conn.execute(
        f"UPDATE {table} SET {assignments} WHERE id = ? AND deleted = 0",  # noqa: S608 - table and columns come from our Table enum and dataclass fields
        (*values.values(), new.id),
    )
    if cursor.rowcount != 1:
        raise LookupError(f"no record {new.id} in {table}")
    events.record(session, kind, new.id, changes)


def delete(session: WriteSession, table: Table, kind: EventKind, record: Record) -> None:
    """Marks a Registry record as deleted and records `kind` with its last values."""
    _check(table)
    cursor = session.conn.execute(
        f"UPDATE {table} SET deleted = 1, modified_at = ?, modified_by = ?"  # noqa: S608 - table and columns come from our Table enum and dataclass fields
        " WHERE id = ? AND deleted = 0",
        (session.tick(), session.machine_id, record.id),
    )
    if cursor.rowcount != 1:
        raise LookupError(f"no record {record.id} in {table}")
    events.record(session, kind, record.id, record)


# SQLite allows at most 32766 parameters per statement.
def labels(
    session: ReadSession, table: Table, column: str, ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, str]:
    """The values of `column` for these records, deleted ones included, by ID."""
    _check(table)
    found: dict[uuid.UUID, str] = {}
    for chunk in chunks(ids):
        placeholders = ", ".join("?" * len(chunk))
        rows = session.conn.execute(
            f"SELECT id, {column} FROM {table} WHERE id IN ({placeholders})",  # noqa: S608 - table and columns come from our Table enum and dataclass fields
            chunk,
        )
        found |= {uuid.UUID(bytes=row[0]): row[1] for row in rows}
    return found
