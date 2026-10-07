import sqlite3
import uuid
from datetime import datetime

import pytest

from hephaistos.core.db import raw, values
from hephaistos.core.db.sessions import read_session, write_session
from hephaistos.core.db.tables import Category, Table
from hephaistos.core.registry import machines, repositories
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.ids import Timestamp
from hephaistos.core.utils.paths import Paths


@pytest.fixture
def set_up(paths: Paths) -> Paths:
    """A Machine with Repositories `one` and `two`."""
    machines.set_up(paths, "laptop")
    with write_session(paths) as session:
        repositories.add(session, "one")
    with write_session(paths) as session:
        repositories.add(session, "two")
    return paths


def _change(paths: Paths, *statements: str) -> None:
    """Runs statements on the database directly, as an older or newer version might have."""
    conn = sqlite3.connect(paths.database)
    with conn:
        for statement in statements:
            conn.execute(statement)
    conn.close()


def test_decoders_match_the_schema(set_up: Paths) -> None:
    with read_session(set_up) as session:
        for table in Table:
            assert sorted(raw.DECODERS[table]) == sorted(raw.stored_columns(session, table))


def test_every_category_but_local_has_its_time_column() -> None:
    for table in Table:
        column = table.category.time_column
        assert (column is None) == (table.category is Category.LOCAL)
        assert column is None or column in raw.DECODERS[table]


def test_tables(set_up: Paths) -> None:
    with read_session(set_up) as session:
        found = {table.name: table for table in raw.tables(session)}
    assert list(found) == list(Table)
    assert (found["meta"].rows, found["meta"].latest) == (3, None)
    assert found["registry_repositories"].rows == 2
    assert isinstance(found["registry_repositories"].latest, Timestamp)
    assert (found["state_worktrees"].rows, found["state_worktrees"].latest) == (0, None)


def test_rows_are_decoded_newest_first(set_up: Paths) -> None:
    with read_session(set_up) as session:
        found = raw.rows(session, "registry_repositories")
        meta = raw.rows(session, "meta")
        machine_id = session.machine_id
    assert found.columns == ["id", "name", "modified_at", "modified_by", "deleted"]
    assert [row[1] for row in found.values] == ["two", "one"]
    assert isinstance(found.values[0][0], uuid.UUID)
    assert isinstance(found.values[0][2], Timestamp)
    assert found.values[0][3] == machine_id
    by_key = {str(key): value for key, value in meta.values}  # decoded by key
    assert by_key["machine_id"] == machine_id
    assert isinstance(by_key["clock"], Timestamp)


def test_rows_of_chosen_columns_and_limited(set_up: Paths) -> None:
    with read_session(set_up) as session:
        found = raw.rows(session, "events", ["kind", "payload"], limit=1)
        with pytest.raises(HephaistosError, match="no column nope; it has id, recorded_at"):
            raw.rows(session, "events", ["kind", "nope"])
        with pytest.raises(HephaistosError, match="no table nope"):
            raw.rows(session, "nope")
    assert found.columns == ["kind", "payload"]
    [[kind, payload]] = found.values
    assert kind == "repository.added"
    assert isinstance(payload, dict)
    assert payload["name"] == "two"


def test_outdated_database_is_shown_as_stored(set_up: Paths) -> None:
    _change(
        set_up,
        "CREATE TABLE old_things (id BLOB, occurred_at INTEGER, key BLOB, note TEXT)",
        "INSERT INTO old_things VALUES (randomblob(16), 1759651200123, x'00ff', 'x')",
        "ALTER TABLE state_worktrees RENAME TO worktrees",
        "DROP INDEX events_key",
        "ALTER TABLE events DROP COLUMN key",
        "UPDATE meta SET value = 'outdated' WHERE key = 'schema_hash'",
    )
    with read_session(set_up, check_schema=False) as session:
        assert not session.has_current_schema
        found = {table.name: table for table in raw.tables(session)}
        events = raw.rows(session, "events", limit=1)
        [old] = raw.rows(session, "old_things").values
    assert found["state_worktrees"].rows is None
    assert (found["old_things"].category, found["old_things"].rows) == (None, 1)
    assert found["worktrees"].category is None
    assert "key" not in events.columns
    # By name where all tables agree; `key` is text in `meta` but bytes in `events`: as stored.
    assert isinstance(old[0], uuid.UUID)
    assert isinstance(old[1], datetime)
    assert old[2:] == ["00ff", "x"]
    assert raw.DECODERS[Table.EVENTS]["key"] is values.hex_bytes
