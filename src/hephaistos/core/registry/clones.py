import sqlite3
import uuid
from collections.abc import Collection, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Self

from hephaistos.core.db.sessions import ReadSession, WriteSession
from hephaistos.core.db.tables import Table
from hephaistos.core.events.kinds import EventKind
from hephaistos.core.registry import mounts, records, repositories
from hephaistos.core.registry.filesystems import Filesystem
from hephaistos.core.registry.records import Record
from hephaistos.core.registry.repositories import Repository
from hephaistos.core.state import clones as state
from hephaistos.core.state.clones import CloneState
from hephaistos.core.utils import git
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.ids import new_id
from hephaistos.core.utils.paths import absolute, displayed


@dataclass(frozen=True, kw_only=True)
class Clone(Record):
    """A git clone of a Repository on a Filesystem."""

    repository_id: uuid.UUID
    filesystem_id: uuid.UUID
    # The top of the working tree, or the git directory if bare. Symlinks resolved; used for
    # identity and comparison.
    resolved_path: Path
    display_path: Path  # the same, as the user typed it, made absolute

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> Self:
        """Builds a Clone from a database row with its columns."""
        return cls(
            id=uuid.UUID(bytes=row["id"]),
            repository_id=uuid.UUID(bytes=row["repository_id"]),
            filesystem_id=uuid.UUID(bytes=row["filesystem_id"]),
            resolved_path=Path(row["resolved_path"]),
            display_path=Path(row["display_path"]),
        )


@dataclass(frozen=True)
class CloneDetails:
    """A Clone with its Repository, Filesystem and State."""

    clone: Clone
    repository: Repository
    filesystem: Filesystem
    state: CloneState


_STATE_COLUMNS = ", ".join(f"s.{column}" for column in state.COLUMNS)


def details(
    session: ReadSession,
    *,
    repository_id: uuid.UUID | None = None,
    filesystem_id: uuid.UUID | None = None,
) -> list[CloneDetails]:
    """The Clones, optionally of one Repository or on one Filesystem, by Repository and path."""
    rows = session.conn.execute(
        "SELECT c.id, c.repository_id, c.filesystem_id, c.resolved_path, c.display_path,"  # noqa: S608 - _STATE_COLUMNS is our own constant
        f" r.name AS repository_name, f.name AS filesystem_name, {_STATE_COLUMNS}"
        " FROM registry_clones c"
        " JOIN registry_repositories r ON r.id = c.repository_id"
        " JOIN registry_filesystems f ON f.id = c.filesystem_id"
        " JOIN state_clones s ON s.clone_id = c.id"
        " WHERE c.deleted = 0 AND coalesce(c.repository_id = ?, 1)"
        " AND coalesce(c.filesystem_id = ?, 1)"
        " ORDER BY r.name, c.display_path",
        (repository_id, filesystem_id),
    )
    return [
        CloneDetails(
            clone=Clone.from_row(row),
            repository=Repository(
                id=uuid.UUID(bytes=row["repository_id"]), name=row["repository_name"]
            ),
            filesystem=Filesystem(
                id=uuid.UUID(bytes=row["filesystem_id"]), name=row["filesystem_name"]
            ),
            state=CloneState.from_row(row),
        )
        for row in rows
    ]


def on_this_machine(session: ReadSession) -> list[CloneDetails]:
    """The Clones on Filesystems that this Machine mounts, which it can observe."""
    filesystem_ids = {
        filesystem.id for _, filesystem in mounts.mounts_of(session, session.machine_id)
    }
    return [existing for existing in details(session) if existing.filesystem.id in filesystem_ids]


@dataclass(frozen=True)
class Candidate:
    """A git repository at a path, inspected for adding as a Clone."""

    resolved_path: Path
    display_path: Path
    snapshot: git.Snapshot

    @property
    def suggested_name(self) -> str:
        """A name for a new Repository: from the origin remote, else from the directory."""
        url = git.main_remote(self.snapshot.remotes)
        if url is not None and (name := git.repository_name(url)):
            return name
        name = self.display_path.name.removesuffix(".git")
        return self.display_path.parent.name if not name or name.startswith(".") else name


def inspect(path: Path) -> Candidate:
    """The git repository at or above `path`, which must not be a linked Worktree."""
    typed = absolute(path)
    if not typed.is_dir():
        raise HephaistosError(f"no such directory: {typed}")
    location = git.locate(typed)
    if location.main is not None:
        raise HephaistosError(
            f"{typed} is in a Worktree of the Clone at {location.main}; add that instead"
        )
    return Candidate(
        resolved_path=location.top,
        display_path=displayed(typed, location.top),
        snapshot=git.snapshot(location.top),
    )


def _normalised(remotes: Mapping[str, str]) -> set[str]:
    """The normalised remote URLs, for matching."""
    return {git.normalise_remote(url) for url in remotes.values()}


def matching(session: ReadSession, candidate: Candidate) -> list[Repository]:
    """The Repositories that `candidate` shares a root commit or remote with, and may join."""
    roots = set(candidate.snapshot.root_commits)
    remotes = _normalised(candidate.snapshot.remotes)
    repositories_by_id: dict[uuid.UUID, Repository] = {}
    known_roots: dict[uuid.UUID, set[str]] = {}
    known_remotes: dict[uuid.UUID, set[str]] = {}
    for existing in details(session):
        key = existing.repository.id
        repositories_by_id[key] = existing.repository
        known_roots.setdefault(key, set()).update(existing.state.root_commits)
        known_remotes.setdefault(key, set()).update(_normalised(existing.state.remotes))
    found = [
        repository
        for key, repository in repositories_by_id.items()
        if (roots & known_roots[key] or remotes & known_remotes[key])
        and git.shares_history(roots, known_roots[key])
    ]
    return sorted(found, key=lambda repository: repository.name)


def add(session: WriteSession, repository_name: str, candidate: Candidate) -> Clone:
    """Registers `candidate` as a Clone of an existing Repository, with its initial State."""
    repository = repositories.by_name(session, repository_name)
    mount, filesystem = mounts.containing(session, session.machine_id, candidate.resolved_path)
    for existing in details(session, filesystem_id=filesystem.id):
        if existing.clone.resolved_path == candidate.resolved_path:
            raise HephaistosError(
                f"{candidate.display_path} is already a Clone of {existing.repository.name}"
            )

    roots = set(candidate.snapshot.root_commits)
    known = {
        root
        for existing in details(session, repository_id=repository.id)
        for root in existing.state.root_commits
    }
    if not git.shares_history(roots, known):
        raise HephaistosError(
            f"{candidate.display_path} shares no history with the Clones of {repository.name}"
        )

    clone = Clone(
        id=new_id(),
        repository_id=repository.id,
        filesystem_id=mount.filesystem_id,
        resolved_path=candidate.resolved_path,
        display_path=candidate.display_path,
    )
    records.add(session, Table.REGISTRY_CLONES, EventKind.CLONE_ADDED, clone)
    state.add(session, clone.id, candidate.snapshot)
    return clone


def find(session: ReadSession, path: Path) -> CloneDetails:
    """The Clone that `path` lies in, on this Machine; the innermost if they are nested."""
    resolved = absolute(path).resolve()
    _, filesystem = mounts.containing(session, session.machine_id, resolved)
    containing = [
        existing
        for existing in details(session, filesystem_id=filesystem.id)
        if resolved.is_relative_to(existing.clone.resolved_path)
    ]
    if not containing:
        raise HephaistosError(f"no Clone registered at {absolute(path)}")
    return max(containing, key=lambda existing: len(existing.clone.resolved_path.parts))


def remove(session: WriteSession, path: Path) -> CloneDetails:
    """Unregisters the Clone that `path` lies in; its files stay untouched."""
    removed = find(session, path)
    records.delete(session, Table.REGISTRY_CLONES, EventKind.CLONE_DELETED, removed.clone)
    return removed


def labels(session: ReadSession, ids: Collection[uuid.UUID]) -> dict[uuid.UUID, Path]:
    """How to show these Clones in place of their IDs: by path."""
    found = records.labels(session, Table.REGISTRY_CLONES, "display_path", ids)
    return {key: Path(value) for key, value in found.items()}
