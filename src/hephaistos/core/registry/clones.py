import sqlite3
import uuid
from collections import defaultdict
from collections.abc import Collection, Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Self

from hephaistos.core.db import values
from hephaistos.core.db.sessions import ReadSession, WriteSession
from hephaistos.core.db.tables import Table
from hephaistos.core.events.kinds import EventKind
from hephaistos.core.registry import mounts, records, repositories
from hephaistos.core.registry.filesystems import Filesystem
from hephaistos.core.registry.records import Record
from hephaistos.core.registry.repositories import Repository
from hephaistos.core.state import clones as state
from hephaistos.core.state import worktrees
from hephaistos.core.state.clones import CloneState
from hephaistos.core.state.worktrees import WorktreeState
from hephaistos.core.utils import git
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.ids import new_id
from hephaistos.core.utils.paths import absolute, displayed

#: The columns of `registry_clones`, decoded for raw views.
DECODERS = records.DECODERS | {
    "repository_id": values.uuid_bytes,
    "filesystem_id": values.uuid_bytes,
    "resolved_path": values.plain,
    "display_path": values.plain,
}


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
    worktrees: tuple[WorktreeState, ...]  # sorted by path


_STATE_COLUMNS = ", ".join(f"s.{column}" for column in state.COLUMNS)


def details(
    session: ReadSession,
    *,
    repository_id: uuid.UUID | None = None,
    filesystem_id: uuid.UUID | None = None,
) -> list[CloneDetails]:
    """The Clones with their Worktrees, optionally of one Repository or on one Filesystem.

    Sorted by Repository and path.
    """
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
    ).fetchall()
    by_clone: dict[uuid.UUID, list[WorktreeState]] = {}
    for worktree in worktrees.of_clones(session, [uuid.UUID(bytes=row["id"]) for row in rows]):
        by_clone.setdefault(worktree.clone_id, []).append(worktree)
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
            worktrees=tuple(by_clone.get(uuid.UUID(bytes=row["id"]), ())),
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
    def remote_name(self) -> str | None:
        """A name from the main remote, unless that is a path on this machine."""
        url = git.main_remote(self.snapshot.remotes)
        if url is None or git.is_local(url):
            return None
        return git.repository_name(url) or None

    @property
    def suggested_name(self) -> str:
        """A name for a new Repository: from the main remote, else from the directory."""
        url = git.main_remote(self.snapshot.remotes)
        if url is not None and (name := git.repository_name(url)):
            return name
        name = self.display_path.name.removesuffix(".git")
        return self.display_path.parent.name if not name or name.startswith(".") else name


def candidate(typed: Path, location: git.Location) -> Candidate:
    """The git repository at `location`, found at `typed`, inspected."""
    return Candidate(
        resolved_path=location.top,
        display_path=displayed(typed, location.top),
        snapshot=git.snapshot(location),
    )


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
    return candidate(typed, location)


def _normalised(remotes: Mapping[str, str]) -> set[str]:
    """The normalised remote URLs, for matching."""
    return {git.normalise_remote(url) for url in remotes.values()}


class Histories:
    """Root commits and remotes by Repository ID, to find the Repositories a Candidate may join."""

    def __init__(self, stored: Iterable[CloneDetails] = ()) -> None:
        """Starts with the histories of the `stored` Clones."""
        self._roots: defaultdict[uuid.UUID, set[str]] = defaultdict(set)
        self._remotes: defaultdict[uuid.UUID, set[str]] = defaultdict(set)
        for existing in stored:
            state = existing.state
            self.include(existing.repository.id, state.root_commits, state.remotes)

    def include(
        self, repository_id: uuid.UUID, roots: Collection[str], remotes: Mapping[str, str]
    ) -> None:
        """Adds a Clone's root commits and remotes to its Repository's."""
        self._roots[repository_id].update(roots)
        self._remotes[repository_id].update(_normalised(remotes))

    def matching(self, candidate: Candidate) -> list[uuid.UUID]:
        """The Repositories that `candidate` shares a root commit or remote with, and may join."""
        roots = set(candidate.snapshot.root_commits)
        remotes = _normalised(candidate.snapshot.remotes)
        return [
            key
            for key, known in self._roots.items()
            if (roots & known or remotes & self._remotes[key]) and git.shares_history(roots, known)
        ]


def matching(session: ReadSession, candidate: Candidate) -> list[Repository]:
    """The Repositories that `candidate` shares a root commit or remote with, and may join."""
    stored = details(session)
    by_id = {existing.repository.id: existing.repository for existing in stored}
    found = [by_id[key] for key in Histories(stored).matching(candidate)]
    return sorted(found, key=lambda repository: repository.name)


def at(session: ReadSession, resolved_path: Path) -> CloneDetails | None:
    """The Clone on this Machine at this path, symlinks resolved; None if there is none."""
    return next(
        (
            existing
            for existing in on_this_machine(session)
            if existing.clone.resolved_path == resolved_path
        ),
        None,
    )


def add(
    session: WriteSession,
    repository_name: str,
    candidate: Candidate,
    *,
    import_history: bool = False,
) -> Clone:
    """Registers `candidate` as a Clone of an existing Repository, with its initial State.

    Its git activity counts from its first observation, or with `import_history` from what
    its reflogs still hold.
    """
    repository = repositories.by_name(session, repository_name)
    mount, _ = mounts.containing(session, session.machine_id, candidate.resolved_path)
    if (existing := at(session, candidate.resolved_path)) is not None:
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
    state.add(session, clone.id, candidate.snapshot, import_history=import_history)
    return clone


@dataclass(frozen=True)
class CheckoutDetails:
    """A Checkout: a Clone, or one of its Worktrees."""

    clone: CloneDetails
    worktree: WorktreeState | None  # None for the Clone's own working tree


def find_checkout(session: ReadSession, path: Path) -> CheckoutDetails:
    """The Checkout on this Machine that `path` lies in, as last observed.

    The innermost if they are nested, e.g. a Worktree inside its Clone's directory.
    """
    resolved = absolute(path).resolve()
    containing = [
        (len(top.parts), CheckoutDetails(existing, worktree))
        for existing in on_this_machine(session)
        for top, worktree in [
            (existing.clone.resolved_path, None),
            *((worktree.path.resolve(), worktree) for worktree in existing.worktrees),
        ]
        if resolved.is_relative_to(top)
    ]
    if not containing:
        raise HephaistosError(f"no Clone or Worktree known at {absolute(path)}")
    return max(containing, key=lambda candidate: candidate[0])[1]


def find(session: ReadSession, path: Path) -> CloneDetails:
    """The Clone that `path` lies in, or whose Worktree it lies in."""
    return find_checkout(session, path).clone


def outdated_clone(
    session: ReadSession, path: Path, timeout: float = git.TIMEOUT
) -> CloneDetails | None:
    """The Clone whose Checkout `path` lies in by git, if the record places it elsewhere.

    E.g. a Worktree not observed yet, or moved since. None if the record agrees with git, or git
    knows no Clone of ours there.
    """
    if not path.exists():
        return None
    try:
        location = git.locate(absolute(path), timeout)
    except git.GitError:
        return None
    try:
        checkout = find_checkout(session, path)
    except HephaistosError:
        checkout = None
    if checkout is not None:
        known = checkout.worktree.path if checkout.worktree else checkout.clone.clone.resolved_path
        if known.resolve() == location.top:
            return None
    return at(session, location.main or location.top)


def find_unobserved(session: ReadSession, path: Path, timeout: float = git.TIMEOUT) -> CloneDetails:
    """Like `find`, but also for a Worktree not observed yet: git knows its Clone."""
    return outdated_clone(session, path, timeout) or find(session, path)


def remove(session: WriteSession, path: Path) -> CloneDetails:
    """Unregisters the Clone that `path` lies in; its files stay untouched."""
    checkout = find_checkout(session, path)
    if checkout.worktree is not None or outdated_clone(session, path) is not None:
        raise HephaistosError(
            f"{absolute(path)} is in a Worktree of the Clone at"
            f" {checkout.clone.clone.display_path}; run this in the Clone"
        )
    removed = checkout.clone
    records.delete(session, Table.REGISTRY_CLONES, EventKind.CLONE_DELETED, removed.clone)
    return removed


def labels(session: ReadSession, ids: Collection[uuid.UUID]) -> dict[uuid.UUID, Path]:
    """How to show these Clones in place of their IDs: by path."""
    found = records.labels(session, Table.REGISTRY_CLONES, "display_path", ids)
    return {key: Path(value) for key, value in found.items()}
