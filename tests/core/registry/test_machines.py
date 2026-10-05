import json
import socket
import sqlite3
import uuid
from pathlib import Path

import pytest

from hephaistos.core.db.sessions import read_session
from hephaistos.core.registry import machines
from hephaistos.core.registry.mounts import mounts_of
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.paths import Paths


def test_setup_registers_machine_filesystem_and_mount(paths: Paths) -> None:
    machine = machines.set_up(paths)
    assert machine.name == socket.gethostname()
    with read_session(paths) as session:
        assert session.machine_id == machine.id
        assert machines.this(session) == machine
        [(mount, filesystem)] = mounts_of(session, machine.id)
    assert mount.path == Path("/")
    assert mount.machine_id == machine.id
    assert filesystem.name == f"{machine.name}-local"


def test_setup_with_name(paths: Paths) -> None:
    assert machines.set_up(paths, "laptop").name == "laptop"


def test_setup_records_events_with_values(paths: Paths) -> None:
    machine = machines.set_up(paths, "laptop")
    with read_session(paths) as session:
        rows = session.conn.execute(
            "SELECT kind, subject, recorded_by, payload FROM events ORDER BY recorded_at"
        ).fetchall()
        registry_times = session.conn.execute(
            "SELECT modified_at FROM registry_machines"
            " UNION ALL SELECT modified_at FROM registry_filesystems"
            " UNION ALL SELECT modified_at FROM registry_mounts"
        ).fetchall()
    assert [row["kind"] for row in rows] == ["machine.added", "filesystem.added", "mount.added"]
    assert all(row["recorded_by"] == machine.id.bytes for row in rows)
    assert rows[0]["subject"] == machine.id.bytes
    assert json.loads(rows[0]["payload"]) == {
        "id": str(machine.id),
        "name": "laptop",
        "hostname": machine.hostname,
        "os_machine_id": machine.os_machine_id,
    }
    assert json.loads(rows[2]["payload"])["path"] == "/"
    assert all(row["modified_at"] > 0 for row in registry_times)


def test_by_name(paths: Paths) -> None:
    machine = machines.set_up(paths, "laptop")
    with read_session(paths) as session:
        assert machines.by_name(session, "laptop") == machine
        with pytest.raises(HephaistosError, match="no Machine named desktop"):
            machines.by_name(session, "desktop")


def _machine_id(database: Path) -> uuid.UUID:
    """The Machine ID in a database file, read without our checks."""
    with sqlite3.connect(database) as conn:
        value = conn.execute("SELECT value FROM meta WHERE key = 'machine_id'").fetchone()[0]
    conn.close()
    return uuid.UUID(bytes=value)


def _outdate(paths: Paths) -> None:
    with sqlite3.connect(paths.database) as conn:
        conn.execute("UPDATE meta SET value = 'old' WHERE key = 'schema_hash'")
    conn.close()


def test_reset_keeps_the_name_and_a_backup(paths: Paths) -> None:
    old = machines.set_up(paths, "laptop")
    assert machines.previous(paths) == old
    new = machines.set_up(paths, reset=True)
    assert (new.name, new.os_machine_id) == ("laptop", old.os_machine_id)
    assert new.id != old.id
    assert _machine_id(paths.database) == new.id
    assert _machine_id(paths.database_backup) == old.id


def test_reset_with_a_new_name(paths: Paths) -> None:
    machines.set_up(paths, "laptop")
    assert machines.set_up(paths, "desktop", reset=True).name == "desktop"


def test_reset_without_a_database_sets_up(paths: Paths) -> None:
    assert machines.previous(paths) is None
    assert machines.set_up(paths, reset=True).name == socket.gethostname()
    assert not paths.database_backup.exists()


def test_reset_an_outdated_database(paths: Paths) -> None:
    machines.set_up(paths, "laptop")
    _outdate(paths)
    assert machines.set_up(paths, reset=True).name == "laptop"
    with read_session(paths) as session:
        assert machines.this(session).name == "laptop"


def test_reset_replaces_the_earlier_backup_with_its_wal(paths: Paths) -> None:
    machines.set_up(paths, "laptop")
    machines.set_up(paths, reset=True)
    stale_wal = Path(f"{paths.database_backup}-wal")
    stale_wal.write_bytes(b"from an earlier backup")
    second = machines.set_up(paths, reset=True)
    # The replaced database's own WAL may take its place, but never the stale one.
    assert not stale_wal.exists() or stale_wal.read_bytes() != b"from an earlier backup"
    assert _machine_id(paths.database_backup) != second.id


def test_failed_reset_keeps_the_old_database(paths: Paths, monkeypatch: pytest.MonkeyPatch) -> None:
    old = machines.set_up(paths, "laptop")

    def fail(*_: object) -> None:
        raise RuntimeError("crash during setup")

    monkeypatch.setattr(machines, "add", fail)
    with pytest.raises(RuntimeError):
        machines.set_up(paths, reset=True)
    assert machines.previous(paths) == old
    assert not paths.database_backup.exists()
