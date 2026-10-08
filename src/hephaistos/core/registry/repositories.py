import dataclasses
import json
import sqlite3
import uuid
from collections import defaultdict
from collections.abc import Collection
from dataclasses import dataclass
from typing import Self

from hephaistos.core.db import values
from hephaistos.core.db.sessions import ReadSession, WriteSession
from hephaistos.core.db.tables import Table
from hephaistos.core.events.kinds import EventKind
from hephaistos.core.registry import records
from hephaistos.core.registry.records import Record
from hephaistos.core.utils import git
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.ids import new_id

#: The columns of `registry_repositories`, decoded for raw views.
DECODERS = records.DECODERS | {
    "name": values.plain,
}


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
    """A Repository with its number of Clones and their main remotes, as shown by `repo list`."""

    repository: Repository
    clones: int
    remotes: tuple[str, ...]  # normalised, distinct, sorted


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
    records.change(
        session, Table.REGISTRY_REPOSITORIES, EventKind.REPOSITORY_CHANGED, repository, renamed
    )
    return renamed


def remove(session: WriteSession, name: str) -> Repository:
    """Removes a Repository without Clones."""
    repository = by_name(session, name)
    [summary] = summaries(session, repository.id)
    if summary.clones:
        raise HephaistosError(f"{name} still has Clones; remove them first")
    records.delete(session, Table.REGISTRY_REPOSITORIES, EventKind.REPOSITORY_DELETED, repository)
    return repository


def summaries(
    session: ReadSession, repository_id: uuid.UUID | None = None
) -> list[RepositorySummary]:
    """The Repositories (or one) with their number of Clones and main remotes, sorted by name."""
    remotes: defaultdict[bytes, set[str]] = defaultdict(set)  # by Repository ID
    for row in session.conn.execute(
        "SELECT c.repository_id, s.remotes FROM registry_clones c"
        " JOIN state_clones s ON s.clone_id = c.id WHERE c.deleted = 0"
    ):
        if (url := git.main_remote(json.loads(row["remotes"]))) is not None:
            remotes[row["repository_id"]].add(git.normalise_remote(url))
    rows = session.conn.execute(
        "SELECT r.id, r.name, count(c.id) AS clones FROM registry_repositories r"
        " LEFT JOIN registry_clones c ON c.repository_id = r.id AND c.deleted = 0"
        " WHERE r.deleted = 0 AND coalesce(r.id = ?, 1) GROUP BY r.id ORDER BY r.name",
        (repository_id,),
    )
    return [
        RepositorySummary(
            Repository.from_row(row), row["clones"], tuple(sorted(remotes[row["id"]]))
        )
        for row in rows
    ]


def labels(session: ReadSession, ids: Collection[uuid.UUID]) -> dict[uuid.UUID, str]:
    """How to show these Repositories in place of their IDs: by name."""
    return records.labels(session, Table.REGISTRY_REPOSITORIES, "name", ids)
