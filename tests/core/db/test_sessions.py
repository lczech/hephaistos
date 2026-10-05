import re
import sqlite3

import pytest

from hephaistos.core.db import sessions
from hephaistos.core.db.sessions import SCHEMA, read_session, write_session
from hephaistos.core.db.tables import Category, Table
from hephaistos.core.registry import machines
from hephaistos.core.utils.errors import AlreadySetUpError, NotSetUpError, SchemaOutdatedError
from hephaistos.core.utils.ids import Timestamp
from hephaistos.core.utils.paths import Paths


@pytest.fixture
def set_up(paths: Paths) -> Paths:
    machines.set_up(paths, "test")
    return paths


def _clock(paths: Paths) -> Timestamp:
    with read_session(paths) as session:
        value = session.meta("clock")
    assert isinstance(value, int)
    return Timestamp(value)


def test_tables_match_schema() -> None:
    in_schema = set(re.findall(r"CREATE TABLE (\w+)", SCHEMA))
    assert in_schema == {table.value for table in Table}


def test_table_categories() -> None:
    assert Table.META.category is Category.LOCAL
    assert Table.REGISTRY_CLONES.category is Category.REGISTRY
    assert Table.STATE_WORKTREES.category is Category.STATE
    assert Table.EVENTS.category is Category.EVENTS


def test_sessions_need_setup(paths: Paths) -> None:
    with pytest.raises(NotSetUpError), read_session(paths):
        pass
    with pytest.raises(NotSetUpError), write_session(paths):
        pass


def test_setup_only_once(set_up: Paths) -> None:
    with pytest.raises(AlreadySetUpError):
        machines.set_up(set_up)


def test_failed_setup_leaves_nothing_set_up(paths: Paths, monkeypatch: pytest.MonkeyPatch) -> None:
    def fail(*_: object) -> None:
        raise RuntimeError("crash during setup")

    monkeypatch.setattr(machines, "add", fail)
    with pytest.raises(RuntimeError):
        machines.set_up(paths)
    assert not paths.database.exists()
    assert list(paths.data_dir.iterdir()) == []

    monkeypatch.undo()
    machines.set_up(paths)
    assert paths.database.exists()


def test_journal_mode_follows_filesystem(paths: Paths, monkeypatch: pytest.MonkeyPatch) -> None:
    def network(_: Paths) -> bool:
        return True

    monkeypatch.setattr(sessions, "data_dir_is_network", network)
    machines.set_up(paths)
    with read_session(paths) as session:
        assert session.journal_mode == "delete"


def test_local_filesystem_uses_wal(set_up: Paths) -> None:
    with read_session(set_up) as session:
        assert session.journal_mode == "wal"


def test_read_session_cannot_write(set_up: Paths) -> None:
    with (
        read_session(set_up) as session,
        pytest.raises(sqlite3.OperationalError, match="readonly"),
    ):
        session.conn.execute("DELETE FROM events")


def test_write_session_persists_clock(set_up: Paths) -> None:
    before = _clock(set_up)
    with write_session(set_up) as session:
        first = session.tick()
        second = session.tick()
    assert before < first < second
    assert _clock(set_up) == second
    with write_session(set_up) as session:
        assert session.tick() > second


def test_write_session_rolls_back_on_error(set_up: Paths) -> None:
    def delete_events_then_fail() -> None:
        with write_session(set_up) as session:
            session.tick()
            session.conn.execute("DELETE FROM events")
            raise RuntimeError

    before = _clock(set_up)
    with pytest.raises(RuntimeError):
        delete_events_then_fail()
    assert _clock(set_up) == before
    with read_session(set_up) as session:
        assert session.conn.execute("SELECT count(*) FROM events").fetchone()[0] > 0


def test_outdated_schema_is_reported(set_up: Paths) -> None:
    with sqlite3.connect(set_up.database) as conn:
        conn.execute("UPDATE meta SET value = 'old' WHERE key = 'schema_hash'")
    conn.close()
    with pytest.raises(SchemaOutdatedError, match="delete"), read_session(set_up):
        pass
