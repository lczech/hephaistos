import socket
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Self

from hephaistos.core.db.sessions import SCHEMA_VERSION, ReadSession, create_database
from hephaistos.core.db.tables import Table
from hephaistos.core.events.kinds import EventKind
from hephaistos.core.registry.filesystems import Filesystem
from hephaistos.core.registry.mounts import Mount, mounts_of
from hephaistos.core.registry.records import Record, add
from hephaistos.core.utils.ids import id_datetime, new_id
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


def this(session: ReadSession) -> Machine:
    """The Machine this database belongs to."""
    return get(session, session.machine_id)


def set_up(paths: Paths, name: str | None = None) -> Machine:
    """Creates the database with this Machine and its default Filesystem, mounted at /."""
    hostname = socket.gethostname()
    machine = Machine(
        id=new_id(), name=name or hostname, hostname=hostname, os_machine_id=os_machine_id()
    )
    filesystem = Filesystem(id=new_id(), name=f"{machine.name}-local")
    mount = Mount(id=new_id(), machine_id=machine.id, filesystem_id=filesystem.id, path=Path("/"))
    with create_database(paths, machine.id) as session:
        add(session, Table.REGISTRY_MACHINES, EventKind.MACHINE_ADDED, machine)
        add(session, Table.REGISTRY_FILESYSTEMS, EventKind.FILESYSTEM_ADDED, filesystem)
        add(session, Table.REGISTRY_MOUNTS, EventKind.MOUNT_ADDED, mount)
    return machine


@dataclass(frozen=True)
class MachineDetails:
    """This Machine with its setup, as shown by `machine show`."""

    machine: Machine
    created: datetime
    paths: Paths
    journal_mode: str
    data_fstype: str
    schema_version: int
    mounts: list[tuple[Mount, Filesystem]]


def details(session: ReadSession, paths: Paths) -> MachineDetails:
    """This Machine with its setup: files, database and mounts."""
    machine = this(session)
    return MachineDetails(
        machine=machine,
        created=id_datetime(machine.id),
        paths=paths,
        journal_mode=session.journal_mode,
        data_fstype=mount_of(paths.data_dir).fstype,
        schema_version=SCHEMA_VERSION,
        mounts=mounts_of(session, machine.id),
    )
