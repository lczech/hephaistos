import socket
import sqlite3
import uuid
from collections.abc import Collection
from dataclasses import dataclass
from pathlib import Path
from typing import Self

from hephaistos.core.db.sessions import SCHEMA_VERSION, ReadSession, create_database, read_session
from hephaistos.core.db.tables import Table
from hephaistos.core.events.kinds import EventKind
from hephaistos.core.registry import records
from hephaistos.core.registry.filesystems import Filesystem
from hephaistos.core.registry.mounts import Mount
from hephaistos.core.registry.records import Record, add
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.ids import new_id
from hephaistos.core.utils.paths import Paths, mount_of, os_machine_id


@dataclass(frozen=True, kw_only=True)
class Machine(Record):
    """A computer running hephaistos, with its own copy of the data."""

    name: str
    hostname: str
    os_machine_id: str | None

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> Self:
        """Builds a Machine from a database row with its columns."""
        return cls(
            id=uuid.UUID(bytes=row["id"]),
            name=row["name"],
            hostname=row["hostname"],
            os_machine_id=row["os_machine_id"],
        )


def get(session: ReadSession, machine_id: uuid.UUID) -> Machine:
    """The Machine with this ID; raises LookupError if there is none."""
    row = session.conn.execute(
        "SELECT id, name, hostname, os_machine_id FROM registry_machines WHERE id = ?",
        (machine_id,),
    ).fetchone()
    if row is None:
        raise LookupError(f"no Machine with ID {machine_id}")
    return Machine.from_row(row)


def by_name(session: ReadSession, name: str) -> Machine:
    """The Machine with this name; raises HephaistosError if there is none."""
    row = session.conn.execute(
        "SELECT id, name, hostname, os_machine_id FROM registry_machines"
        " WHERE name = ? AND deleted = 0",
        (name,),
    ).fetchone()
    if row is None:
        raise HephaistosError(f"no Machine named {name}")
    return Machine.from_row(row)


def listing(session: ReadSession) -> list[Machine]:
    """All Machines, sorted by name."""
    rows = session.conn.execute(
        "SELECT id, name, hostname, os_machine_id FROM registry_machines"
        " WHERE deleted = 0 ORDER BY name"
    )
    return [Machine.from_row(row) for row in rows]


def this(session: ReadSession) -> Machine:
    """The Machine this database belongs to."""
    return get(session, session.machine_id)


def previous(paths: Paths) -> Machine | None:
    """This Machine as the existing database has it, even an outdated one; None if unreadable."""
    try:
        with read_session(paths, check_schema=False) as session:
            return this(session)
    except (HephaistosError, LookupError, sqlite3.Error):
        return None


def set_up(paths: Paths, name: str | None = None, *, reset: bool = False) -> Machine:
    """Creates the database with this Machine and its default Filesystem, mounted at /.

    With `reset`, an existing database is replaced (and kept as a backup); the new Machine has a
    new ID, and keeps the previous name unless given one.
    """
    hostname = socket.gethostname()
    if reset and not name and (old := previous(paths)):
        name = old.name
    machine = Machine(
        id=new_id(), name=name or hostname, hostname=hostname, os_machine_id=os_machine_id()
    )
    filesystem = Filesystem(id=new_id(), name=f"{machine.name}-local")
    mount = Mount(id=new_id(), machine_id=machine.id, filesystem_id=filesystem.id, path=Path("/"))
    with create_database(paths, machine.id, replace=reset) as session:
        add(session, Table.REGISTRY_MACHINES, EventKind.MACHINE_ADDED, machine)
        add(session, Table.REGISTRY_FILESYSTEMS, EventKind.FILESYSTEM_ADDED, filesystem)
        add(session, Table.REGISTRY_MOUNTS, EventKind.MOUNT_ADDED, mount)
    return machine


@dataclass(frozen=True)
class LocalSetup:
    """How this Machine keeps its files and database; other Machines' setups aren't known."""

    paths: Paths
    journal_mode: str
    data_fstype: str
    schema_version: int


def local_setup(session: ReadSession, paths: Paths) -> LocalSetup:
    """This Machine's setup: files and database."""
    return LocalSetup(
        paths=paths,
        journal_mode=session.journal_mode,
        data_fstype=mount_of(paths.data_dir).fstype,
        schema_version=SCHEMA_VERSION,
    )


def labels(session: ReadSession, ids: Collection[uuid.UUID]) -> dict[uuid.UUID, str]:
    """How to show these Machines in place of their IDs: by name."""
    return records.labels(session, Table.REGISTRY_MACHINES, "name", ids)
