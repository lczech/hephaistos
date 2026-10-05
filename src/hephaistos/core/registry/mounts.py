import sqlite3
import uuid
from collections.abc import Collection
from dataclasses import dataclass
from pathlib import Path
from typing import Self

from hephaistos.core.db.sessions import ReadSession
from hephaistos.core.db.tables import Table
from hephaistos.core.registry import records
from hephaistos.core.registry.filesystems import Filesystem
from hephaistos.core.registry.records import Record


@dataclass(frozen=True, kw_only=True)
class Mount(Record):
    """A Machine sees a Filesystem at `path`."""

    machine_id: uuid.UUID
    filesystem_id: uuid.UUID
    path: Path

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> Self:
        """Builds a Mount from a database row with its columns."""
        return cls(
            id=uuid.UUID(bytes=row["id"]),
            machine_id=uuid.UUID(bytes=row["machine_id"]),
            filesystem_id=uuid.UUID(bytes=row["filesystem_id"]),
            path=Path(row["path"]),
        )


def mounts_of(session: ReadSession, machine_id: uuid.UUID) -> list[tuple[Mount, Filesystem]]:
    """The Machine's mounts with their Filesystems, sorted by path."""
    rows = session.conn.execute(
        "SELECT m.id, m.machine_id, m.filesystem_id, m.path, f.name"
        " FROM registry_mounts m JOIN registry_filesystems f ON f.id = m.filesystem_id"
        " WHERE m.machine_id = ? AND m.deleted = 0 ORDER BY m.path",
        (machine_id,),
    )
    return [
        (
            Mount.from_row(row),
            Filesystem(id=uuid.UUID(bytes=row["filesystem_id"]), name=row["name"]),
        )
        for row in rows
    ]


def containing(session: ReadSession, machine_id: uuid.UUID, path: Path) -> tuple[Mount, Filesystem]:
    """The Machine's mount that `path` (resolved) lies on: the one with the deepest path."""
    candidates = [
        (mount, filesystem)
        for mount, filesystem in mounts_of(session, machine_id)
        if path.is_relative_to(mount.path)
    ]
    if not candidates:
        raise LookupError(f"no mount contains {path}")
    return max(candidates, key=lambda candidate: len(candidate[0].path.parts))


def labels(session: ReadSession, ids: Collection[uuid.UUID]) -> dict[uuid.UUID, Path]:
    """How to show these Mounts in place of their IDs: by path."""
    found = records.labels(session, Table.REGISTRY_MOUNTS, "path", ids)
    return {key: Path(value) for key, value in found.items()}
