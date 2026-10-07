"""Raw views: every table as stored, its values decoded as the module owning the table declares.

Works on outdated databases too: columns are read as they are, decoded by name where this version
knows the name, and shown as stored otherwise.
"""

import sqlite3
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from hephaistos.core.db import sessions, values
from hephaistos.core.db.sessions import ReadSession
from hephaistos.core.db.tables import Category, Table
from hephaistos.core.db.values import Decoder
from hephaistos.core.events import events
from hephaistos.core.registry import clones, filesystems, machines, mounts, repositories
from hephaistos.core.state import clones as clone_states
from hephaistos.core.state import worktrees
from hephaistos.core.utils.errors import HephaistosError

DECODERS: dict[Table, Mapping[str, Decoder]] = {
    Table.META: sessions.DECODERS,
    Table.REGISTRY_MACHINES: machines.DECODERS,
    Table.REGISTRY_FILESYSTEMS: filesystems.DECODERS,
    Table.REGISTRY_MOUNTS: mounts.DECODERS,
    Table.REGISTRY_REPOSITORIES: repositories.DECODERS,
    Table.REGISTRY_CLONES: clones.DECODERS,
    Table.STATE_CLONES: clone_states.DECODERS,
    Table.STATE_WORKTREES: worktrees.DECODERS,
    Table.EVENTS: events.DECODERS,
}


def _by_name() -> dict[str, Decoder]:
    """Decoders by column name, for names decoded the same way in every table that has them."""
    found: defaultdict[str, set[Decoder]] = defaultdict(set)
    for columns in DECODERS.values():
        for name, decoder in columns.items():
            found[name].add(decoder)
    return {name: next(iter(decoders)) for name, decoders in found.items() if len(decoders) == 1}


_BY_NAME = _by_name()


@dataclass(frozen=True)
class TableSummary:
    """A table as `db tables` lists it."""

    name: str
    category: Category | None  # None if not in this version's schema
    rows: int | None  # None if missing from the database
    latest: object  # the newest value of its category's time column, decoded


@dataclass(frozen=True)
class Rows:
    """Rows of a table, decoded, with the names of their columns."""

    columns: list[str]
    values: list[list[object]]


def _quoted(name: str) -> str:
    """A table or column name as an SQL identifier."""
    return '"' + name.replace('"', '""') + '"'


def _known(name: str) -> Table | None:
    """The table of this version's schema with this name, if any."""
    try:
        return Table(name)
    except ValueError:
        return None


def _decoder(table: Table | None, column: str) -> Decoder:
    """How to decode a column: as its table declares, else by its name, else as stored."""
    declared = DECODERS[table].get(column) if table is not None else None
    return declared or _BY_NAME.get(column, values.fallback)


def stored_tables(session: ReadSession) -> list[str]:
    """The names of the tables in the database, SQLite's own left out."""
    rows = session.conn.execute(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
        " ORDER BY name"
    )
    return [row[0] for row in rows]


def stored_columns(session: ReadSession, table: str) -> list[str]:
    """The names of a table's columns in the database; raises HephaistosError if it has none."""
    rows = session.conn.execute(f"PRAGMA table_info({_quoted(table)})").fetchall()
    if not rows:
        raise HephaistosError(f"no table {table}; `hephaistos db tables` lists them")
    return [row["name"] for row in rows]


def _latest(session: ReadSession, table: Table, columns: Sequence[str]) -> object:
    """The newest value of the table's time column, decoded; None without one."""
    column = table.category.time_column
    if column is None or column not in columns:
        return None
    query = f"SELECT max({_quoted(column)}) FROM {_quoted(table)}"  # noqa: S608 - names quoted
    return _decoder(table, column)(session.conn.execute(query).fetchone()[0])


def _count(session: ReadSession, table: str) -> int:
    """The number of rows in a table."""
    query = f"SELECT count(*) FROM {_quoted(table)}"  # noqa: S608 - name quoted
    return session.conn.execute(query).fetchone()[0]


def tables(session: ReadSession) -> list[TableSummary]:
    """This version's tables in schema order, missing ones included, then any others by name."""
    stored = stored_tables(session)
    found: list[TableSummary] = []
    for table in Table:
        if table not in stored:
            found.append(TableSummary(table, table.category, None, None))
            continue
        latest = _latest(session, table, stored_columns(session, table))
        found.append(TableSummary(table, table.category, _count(session, table), latest))
    unknown = [name for name in stored if _known(name) is None]
    found.extend(TableSummary(name, None, _count(session, name), None) for name in unknown)
    return found


def _order(table: Table | None, columns: Sequence[str]) -> str:
    """How to sort a table's rows: newest first by its time column, else by insertion."""
    if table is Table.META:
        return "key"
    column = table.category.time_column if table is not None else None
    return f"{_quoted(column)} DESC" if column is not None and column in columns else "rowid DESC"


def _decoded(table: Table | None, row: sqlite3.Row) -> dict[str, object]:
    """A row's values by column, decoded; `meta`'s values by their key."""
    decoded = {column: _decoder(table, column)(row[column]) for column in row.keys()}  # noqa: SIM118 - iterating a Row gives values
    if table is Table.META:
        decoded["value"] = sessions.META_VALUES.get(row["key"], values.fallback)(row["value"])
    return decoded


def rows(
    session: ReadSession, table: str, columns: Sequence[str] = (), limit: int | None = None
) -> Rows:
    """A table's rows, newest first, decoded; only `columns` if given, else all."""
    stored = stored_columns(session, table)
    if missing := [column for column in columns if column not in stored]:
        raise HephaistosError(
            f"{table} has no column {', '.join(missing)}; it has {', '.join(stored)}"
        )
    known = _known(table)
    query = f"SELECT * FROM {_quoted(table)} ORDER BY {_order(known, stored)} LIMIT ?"  # noqa: S608 - names quoted
    cursor = session.conn.execute(query, (limit or -1,))  # SQLite: a negative limit is none
    shown = list(columns) or stored
    decoded = [_decoded(known, row) for row in cursor]
    return Rows(shown, [[row[column] for column in shown] for row in decoded])
