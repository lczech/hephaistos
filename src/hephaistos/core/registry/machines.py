import dataclasses
import logging
import re
import socket
import sqlite3
import subprocess
import uuid
from collections.abc import Collection
from dataclasses import dataclass
from pathlib import Path
from typing import Self

from hephaistos.core import config
from hephaistos.core.config import ChassisSetting
from hephaistos.core.db import values
from hephaistos.core.db.sessions import (
    SCHEMA_VERSION,
    ReadSession,
    create_database,
    read_session,
    write_session,
)
from hephaistos.core.db.tables import Table
from hephaistos.core.events.kinds import EventKind
from hephaistos.core.registry import records
from hephaistos.core.registry.filesystems import Filesystem
from hephaistos.core.registry.mounts import Mount
from hephaistos.core.registry.records import Record, add, change
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.ids import new_id
from hephaistos.core.utils.paths import Paths, mount_of, os_machine_id

HOSTNAMECTL_TIMEOUT = 5.0  # seconds; systemd answers over D-Bus

log = logging.getLogger(__name__)

#: The columns of `registry_machines`, decoded for raw listings.
DECODERS = records.DECODERS | {
    "name": values.plain,
    "hostname": values.plain,
    "chassis": values.plain,
    "os_machine_id": values.plain,
}
COLUMNS = ("id", "name", "hostname", "chassis", "os_machine_id")


@dataclass(frozen=True, kw_only=True)
class Machine(Record):
    """A computer running hephaistos, with its own copy of the data."""

    name: str
    hostname: str
    chassis: str | None  # as systemd names it: `laptop`, `server`, `vm`, …; None if unknown
    os_machine_id: str | None

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> Self:
        """Builds a Machine from a database row with its columns."""
        return cls(
            id=uuid.UUID(bytes=row["id"]),
            name=row["name"],
            hostname=row["hostname"],
            chassis=row["chassis"],
            os_machine_id=row["os_machine_id"],
        )


def get(session: ReadSession, machine_id: uuid.UUID) -> Machine:
    """The Machine with this ID; raises LookupError if there is none."""
    row = session.conn.execute(
        f"SELECT {', '.join(COLUMNS)} FROM registry_machines WHERE id = ?",  # noqa: S608 - our own constant
        (machine_id,),
    ).fetchone()
    if row is None:
        raise LookupError(f"no Machine with ID {machine_id}")
    return Machine.from_row(row)


def by_name(session: ReadSession, name: str) -> Machine:
    """The Machine with this name; raises HephaistosError if there is none."""
    row = session.conn.execute(
        f"SELECT {', '.join(COLUMNS)} FROM registry_machines WHERE name = ? AND deleted = 0",  # noqa: S608 - our own constant
        (name,),
    ).fetchone()
    if row is None:
        raise HephaistosError(f"no Machine named {name}")
    return Machine.from_row(row)


def listing(session: ReadSession) -> list[Machine]:
    """All Machines, sorted by name."""
    rows = session.conn.execute(
        f"SELECT {', '.join(COLUMNS)} FROM registry_machines WHERE deleted = 0 ORDER BY name"  # noqa: S608 - our own constant
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
    except (HephaistosError, LookupError, sqlite3.Error) as error:
        log.debug("the existing database is unreadable: %s", error)
        return None


def hostnamectl(*args: str) -> str | None:
    """What `hostnamectl` prints with these arguments; None if it fails or isn't there."""
    try:
        done = subprocess.run(  # noqa: S603 - a fixed command
            ["hostnamectl", *args],  # noqa: S607 - found on PATH, as systemd installs it
            capture_output=True,
            text=True,
            timeout=HOSTNAMECTL_TIMEOUT,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        log.debug("hostnamectl %s failed: %s", " ".join(args), error)
        return None
    return done.stdout.strip() if done.returncode == 0 else None


def detected_chassis() -> str | None:
    """This Machine's chassis as systemd knows it; None if it doesn't.

    `hostnamectl chassis` needs systemd 249; older ones show it in `hostnamectl status`.
    """
    told = hostnamectl("chassis")
    if told is None:
        found = re.search(r"^\s*Chassis:\s*(\w+)", hostnamectl("status") or "", re.MULTILINE)
        told = found and found[1]
    return told or None


def chassis() -> str | None:
    """This Machine's chassis: as `machine.chassis` sets it, else as detected."""
    setting = config.settings().machine.chassis
    return detected_chassis() if setting is ChassisSetting.AUTO else setting.value


def update(paths: Paths) -> Machine:
    """Updates what this Machine is as it changes: its chassis; records `machine.changed`."""
    found = chassis()
    with write_session(paths) as session:
        old = this(session)
        new = dataclasses.replace(old, chassis=found)
        change(session, Table.REGISTRY_MACHINES, EventKind.MACHINE_CHANGED, old, new)
    return new


def set_up(paths: Paths, name: str | None = None, *, reset: bool = False) -> Machine:
    """Creates the database with this Machine and its default Filesystem, mounted at /.

    With `reset`, an existing database is replaced (and kept as a backup); the new Machine has a
    new ID, and keeps the previous name unless given one.
    """
    hostname = socket.gethostname()
    if reset and not name and (old := previous(paths)):
        name = old.name
    machine = Machine(
        id=new_id(),
        name=name or hostname,
        hostname=hostname,
        chassis=chassis(),
        os_machine_id=os_machine_id(),
    )
    filesystem = Filesystem(id=new_id(), name=f"{machine.name}-local")
    mount = Mount(id=new_id(), machine_id=machine.id, filesystem_id=filesystem.id, path=Path("/"))
    with create_database(paths, machine.id, replace=reset) as session:
        add(session, Table.REGISTRY_MACHINES, EventKind.MACHINE_REGISTERED, machine)
        add(session, Table.REGISTRY_FILESYSTEMS, EventKind.FILESYSTEM_REGISTERED, filesystem)
        add(session, Table.REGISTRY_MOUNTS, EventKind.MOUNT_REGISTERED, mount)
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


def names(session: ReadSession, ids: Collection[uuid.UUID]) -> dict[uuid.UUID, str]:
    """These Machines' names."""
    return records.column_values(session, Table.REGISTRY_MACHINES, "name", ids)


def chassis_of(session: ReadSession, ids: Collection[uuid.UUID]) -> dict[uuid.UUID, str]:
    """These Machines' chassis, as systemd names them, where known."""
    return records.column_values(session, Table.REGISTRY_MACHINES, "chassis", ids)
