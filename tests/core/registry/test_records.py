import dataclasses
import sqlite3
from pathlib import Path

import pytest

from hephaistos.core.db.sessions import ReadSession, write_session
from hephaistos.core.db.tables import Category, Table
from hephaistos.core.events.kinds import EventKind
from hephaistos.core.registry import clones, machines, records, repositories
from hephaistos.core.utils.ids import new_id
from hephaistos.core.utils.paths import Paths
from support import create

TABLE = Table.REGISTRY_REPOSITORIES


def _events(session: ReadSession) -> int:
    return session.conn.execute("SELECT count(*) FROM events").fetchone()[0]


def test_a_deleted_record_is_neither_changed_nor_deleted_again(paths: Paths) -> None:
    machines.set_up(paths, "laptop")
    with write_session(paths) as session:
        repository = repositories.register(session, "proj")
        records.delete(session, TABLE, EventKind.REPOSITORY_UNREGISTERED, repository)
        before = _events(session)
        renamed = dataclasses.replace(repository, name="other")
        with pytest.raises(LookupError, match=f"no record {repository.id}"):
            records.change(session, TABLE, EventKind.REPOSITORY_CHANGED, repository, renamed)
        with pytest.raises(LookupError, match=f"no record {repository.id}"):
            records.delete(session, TABLE, EventKind.REPOSITORY_UNREGISTERED, repository)
        assert _events(session) == before


def test_only_registry_tables_take_records(paths: Paths) -> None:
    machines.set_up(paths, "laptop")
    with write_session(paths) as session:
        repository = repositories.register(session, "proj")
        with pytest.raises(ValueError, match="is not a registry table"):
            records.add(session, Table.STATE_CLONES, EventKind.REPOSITORY_REGISTERED, repository)


def _columns(session: ReadSession, table: Table) -> list[str]:
    return [row[1] for row in session.conn.execute(f"PRAGMA table_info({table})")]


@pytest.mark.parametrize("table", [table for table in Table if table.category is Category.REGISTRY])
def test_registry_rows_are_unique_only_while_not_deleted(
    paths: Paths, tmp_path: Path, table: Table
) -> None:
    # Names of Machines, Filesystems and Repositories, paths of Mounts and Clones: a copy of a row
    # under a new ID is refused while the row stands, and taken once it is deleted.
    machines.set_up(paths, "laptop")
    with write_session(paths) as session:
        repositories.register(session, "proj")
        clones.register(session, "proj", clones.inspect(create(tmp_path / "repo")))
    with write_session(paths) as session:
        columns = _columns(session, table)
        assert columns[-3:] == ["modified_at", "modified_by", "deleted"]
        [row_id] = session.conn.execute(f"SELECT id FROM {table} LIMIT 1").fetchone()  # noqa: S608
        others = ", ".join(columns[1:])
        copy = f"INSERT INTO {table} (id, {others}) SELECT ?, {others} FROM {table} WHERE id = ?"  # noqa: S608
        with pytest.raises(sqlite3.IntegrityError, match="UNIQUE"):
            session.conn.execute(copy, (new_id().bytes, row_id))
        session.conn.execute(f"UPDATE {table} SET deleted = 1 WHERE id = ?", (row_id,))  # noqa: S608
        session.conn.execute(copy, (new_id().bytes, row_id))
