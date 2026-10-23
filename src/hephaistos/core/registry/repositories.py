import dataclasses
import json
import re
import sqlite3
import uuid
from collections import defaultdict
from collections.abc import Collection
from dataclasses import dataclass
from datetime import datetime
from typing import Self

from hephaistos.core.db import values
from hephaistos.core.db.sessions import ReadSession, WriteSession
from hephaistos.core.db.tables import Table
from hephaistos.core.events.kinds import EventKind
from hephaistos.core.registry import records
from hephaistos.core.registry.records import Record
from hephaistos.core.state.activity import Cursor
from hephaistos.core.utils import git
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.ids import new_id

#: The columns of `registry_repositories`, decoded for raw listings.
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
    """A Repository with its number of Clones, their main remotes and when HEAD last moved."""

    repository: Repository
    clones: int
    remotes: tuple[str, ...]  # normalised, distinct, sorted
    active_at: datetime | None  # the latest of its Clones' and Worktrees'; None if unknown


#: What a name may be, as on GitHub; the schema checks the same. Names compare ignoring case.
_NAME = re.compile(r"[A-Za-z0-9._-]{1,100}")
_NOT_NAMES = {".", ".."}


def check_name(name: str) -> None:
    """Raises HephaistosError unless `name` may name a Repository."""
    if not _NAME.fullmatch(name) or name in _NOT_NAMES:
        raise HephaistosError(
            f"{name!r} is not a Repository name: those have only ASCII letters, digits,"
            " '.', '-' and '_', at most 100, and aren't '.' or '..'"
        )


def derived_name(text: str) -> str | None:
    """A Repository name from `text`, e.g. a directory's: `My Thesis` → `My-Thesis`.

    Each run of characters a name can't have becomes a `-`, as GitHub does, without one at either
    end; None if no name is left.
    """
    name = re.sub(r"[^A-Za-z0-9._-]+", "-", text).strip("-")[:100]
    return None if not name or name in _NOT_NAMES else name


def name_key(name: str) -> str:
    """What names compare by: ignoring case, as the database's NOCASE does for ASCII."""
    return name.lower()


def _check_available(session: ReadSession, name: str) -> None:
    """Raises HephaistosError if `name` is not usable for a new Repository."""
    check_name(name)
    if (existing := find(session, name)) is not None:
        raise HephaistosError(f"a Repository named {existing.name} already exists")


def register(session: WriteSession, name: str) -> Repository:
    """Registers a Repository without Clones."""
    _check_available(session, name)
    repository = Repository(id=new_id(), name=name)
    records.add(session, Table.REGISTRY_REPOSITORIES, EventKind.REPOSITORY_REGISTERED, repository)
    return repository


def find(session: ReadSession, name: str) -> Repository | None:
    """The Repository with this name, ignoring case; None if there is none."""
    row = session.conn.execute(
        "SELECT id, name FROM registry_repositories WHERE name = ? AND deleted = 0", (name,)
    ).fetchone()
    return None if row is None else Repository.from_row(row)


def by_name(session: ReadSession, name: str) -> Repository:
    """The Repository with this name, ignoring case; raises HephaistosError if there is none."""
    if (repository := find(session, name)) is None:
        raise HephaistosError(f"no Repository named {name}")
    return repository


def rename(session: WriteSession, name: str, new_name: str) -> Repository:
    """Gives a Repository a new name; one differing only in case is allowed."""
    repository = by_name(session, name)
    if name_key(new_name) == name_key(repository.name):
        check_name(new_name)
    else:
        _check_available(session, new_name)
    renamed = dataclasses.replace(repository, name=new_name)
    records.change(
        session, Table.REGISTRY_REPOSITORIES, EventKind.REPOSITORY_CHANGED, repository, renamed
    )
    return renamed


def unregister(session: WriteSession, name: str) -> Repository:
    """Unregisters a Repository without Clones."""
    repository = by_name(session, name)
    [summary] = summaries(session, repository.id)
    if summary.clones:
        raise HephaistosError(f"{name} still has Clones; unregister them first")
    records.delete(
        session, Table.REGISTRY_REPOSITORIES, EventKind.REPOSITORY_UNREGISTERED, repository
    )
    return repository


def summaries(
    session: ReadSession, repository_id: uuid.UUID | None = None
) -> list[RepositorySummary]:
    """The Repositories (or one) with their number of Clones and more, sorted by name."""
    remotes: defaultdict[bytes, set[str]] = defaultdict(set)  # by Repository ID
    active: defaultdict[bytes, list[datetime]] = defaultdict(list)
    for row in session.conn.execute(
        "SELECT c.repository_id, s.remotes, s.head_log FROM registry_clones c"
        " JOIN state_clones s ON s.clone_id = c.id WHERE c.deleted = 0"
        " UNION ALL SELECT c.repository_id, NULL, w.head_log FROM registry_clones c"
        " JOIN state_worktrees w ON w.clone_id = c.id WHERE c.deleted = 0 AND w.removed = 0"
    ):
        if row["remotes"] and (url := git.main_remote(json.loads(row["remotes"]))) is not None:
            remotes[row["repository_id"]].add(git.normalise_remote(url))
        if row["head_log"] and (at := Cursor.from_text(row["head_log"]).at) is not None:
            active[row["repository_id"]].append(at)
    rows = session.conn.execute(
        "SELECT r.id, r.name, count(c.id) AS clones FROM registry_repositories r"
        " LEFT JOIN registry_clones c ON c.repository_id = r.id AND c.deleted = 0"
        " WHERE r.deleted = 0 AND coalesce(r.id = ?, 1) GROUP BY r.id ORDER BY r.name",
        (repository_id,),
    )
    return [
        RepositorySummary(
            Repository.from_row(row),
            row["clones"],
            tuple(sorted(remotes[row["id"]])),
            max(active[row["id"]], default=None),
        )
        for row in rows
    ]


def names(session: ReadSession, ids: Collection[uuid.UUID]) -> dict[uuid.UUID, str]:
    """These Repositories' names, deleted ones included."""
    return records.column_values(session, Table.REGISTRY_REPOSITORIES, "name", ids)
