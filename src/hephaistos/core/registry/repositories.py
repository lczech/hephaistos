import dataclasses
import sqlite3
import uuid
from dataclasses import dataclass
from typing import Self

from hephaistos.core.db.sessions import ReadSession, WriteSession
from hephaistos.core.db.tables import Table
from hephaistos.core.events.kinds import EventKind
from hephaistos.core.registry import records
from hephaistos.core.registry.records import Record
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.ids import new_id


@dataclass(frozen=True, kw_only=True)
class Repository(Record):
    """A project under git, with its Clones on any Filesystem."""

    name: str

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> Self:
        """Builds a Repository from a database row with its columns."""
        return cls(id=uuid.UUID(bytes=row["id"]), name=row["name"])


@dataclass(frozen=True)
class RepositorySummary:
    """A Repository with its number of Clones, as shown by `repo list`."""

    repository: Repository
    clones: int


def _check_name(session: ReadSession, name: str) -> None:
    """Raises HephaistosError if `name` is not usable for a new Repository."""
    if not name or name != name.strip():
        raise HephaistosError("a name must not be empty or start or end with spaces")
    row = session.conn.execute(
        "SELECT 1 FROM registry_repositories WHERE name = ? AND deleted = 0", (name,)
    ).fetchone()
    if row is not None:
        raise HephaistosError(f"a Repository named {name} already exists")


def add(session: WriteSession, name: str) -> Repository:
    """Adds a Repository without Clones."""
    _check_name(session, name)
    repository = Repository(id=new_id(), name=name)
    records.add(session, Table.REGISTRY_REPOSITORIES, EventKind.REPOSITORY_ADDED, repository)
    return repository


def by_name(session: ReadSession, name: str) -> Repository:
    """The Repository with this name; raises HephaistosError if there is none."""
    row = session.conn.execute(
        "SELECT id, name FROM registry_repositories WHERE name = ? AND deleted = 0", (name,)
    ).fetchone()
    if row is None:
        raise HephaistosError(f"no Repository named {name}")
    return Repository.from_row(row)


def rename(session: WriteSession, name: str, new_name: str) -> Repository:
    """Gives a Repository a new name."""
    repository = by_name(session, name)
    _check_name(session, new_name)
    renamed = dataclasses.replace(repository, name=new_name)
    records.change(session, Table.REGISTRY_REPOSITORIES, EventKind.REPOSITORY_CHANGED, renamed)
    return renamed


def summaries(session: ReadSession) -> list[RepositorySummary]:
    """All Repositories with their number of Clones, sorted by name."""
    rows = session.conn.execute(
        "SELECT r.id, r.name, count(c.id) AS clones FROM registry_repositories r"
        " LEFT JOIN registry_clones c ON c.repository_id = r.id AND c.deleted = 0"
        " WHERE r.deleted = 0 GROUP BY r.id ORDER BY r.name"
    )
    return [RepositorySummary(Repository.from_row(row), row["clones"]) for row in rows]
