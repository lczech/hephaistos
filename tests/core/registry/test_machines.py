import json
import socket
from pathlib import Path

from hephaistos.core.db.sessions import read_session
from hephaistos.core.registry import machines
from hephaistos.core.utils.paths import Paths


def test_setup_registers_machine_filesystem_and_mount(paths: Paths) -> None:
    machine = machines.set_up(paths)
    assert machine.name == socket.gethostname()
    with read_session(paths) as session:
        assert session.machine_id == machine.id
        assert machines.this(session) == machine
        info = machines.details(session, paths)
    [(mount, filesystem)] = info.mounts
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
