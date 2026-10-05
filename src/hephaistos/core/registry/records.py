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


# In the SQL below, table and column names come from our Table enum and dataclass fields,
# never from input.


def add(session: WriteSession, table: Table, kind: EventKind, record: Record) -> None:
    """Inserts a new Registry record and records `kind` with its values."""
    _check(table)
    values = _values(session, record)
    columns = ", ".join(values)
    placeholders = ", ".join("?" * len(values))
    session.conn.execute(
        f"INSERT INTO {table} ({columns}) VALUES ({placeholders})",  # noqa: S608
        tuple(values.values()),
    )
    store.record(session, kind, record.id, record)


def change(session: WriteSession, table: Table, kind: EventKind, record: Record) -> None:
    """Replaces a Registry record's values and records `kind` with the new ones."""
    _check(table)
    values = _values(session, record)
    assignments = ", ".join(f"{column} = ?" for column in values)
    cursor = session.conn.execute(
        f"UPDATE {table} SET {assignments} WHERE id = ? AND deleted = 0",  # noqa: S608
        (*values.values(), record.id),
    )
    if cursor.rowcount != 1:
        raise LookupError(f"no record {record.id} in {table}")
    store.record(session, kind, record.id, record)


def delete(session: WriteSession, table: Table, kind: EventKind, record: Record) -> None:
    """Marks a Registry record as deleted and records `kind` with its last values."""
    _check(table)
    cursor = session.conn.execute(
        f"UPDATE {table} SET deleted = 1, modified_at = ?, modified_by = ?"  # noqa: S608
        " WHERE id = ? AND deleted = 0",
        (session.tick(), session.machine_id, record.id),
    )
    if cursor.rowcount != 1:
        raise LookupError(f"no record {record.id} in {table}")
    store.record(session, kind, record.id, record)
