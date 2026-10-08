import dataclasses
import sqlite3
import uuid
from collections import defaultdict
from collections.abc import Collection, Iterable, Mapping, Sequence
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
from hephaistos.core.utils.paths import absolute, displayed, shell_path

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
    """The git repository at `location`, found at `typed`, inspected; not a submodule."""
    display_path = displayed(typed, location.top)
    if (parent := git.superproject(location.top)) is not None:
        raise HephaistosError(f"{display_path} is a submodule of {parent}; add that instead")
    return Candidate(
        resolved_path=location.top,
        display_path=display_path,
        snapshot=git.snapshot(location),
    )


def _located(path: Path) -> tuple[Path, git.Location]:
    """`path` made absolute, and the git repository at or above it, which must not be a Worktree."""
    typed = absolute(path)
    if not typed.is_dir():
        raise HephaistosError(f"no such directory: {typed}")
    location = git.locate(typed)
    if location.main is not None:
        raise HephaistosError(
            f"{typed} is in a Worktree of the Clone at {location.main}; add that instead"
        )
    return typed, location


def inspect(path: Path) -> Candidate:
    """The git repository at or above `path`, which must not be a linked Worktree."""
    return candidate(*_located(path))


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


def _check_unregistered(session: ReadSession, candidate: Candidate) -> None:
    """Raises HephaistosError if `candidate` is a Clone already."""
    if (existing := at(session, candidate.resolved_path)) is not None:
        raise HephaistosError(
            f"{candidate.display_path} is already a Clone of {existing.repository.name}"
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
    _check_unregistered(session, candidate)

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


def _recorded_checkout(session: ReadSession, path: Path) -> CheckoutDetails | None:
    """The innermost Checkout whose recorded directory contains `path`; None if none does."""
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
    return max(containing, key=lambda candidate: candidate[0])[1] if containing else None


def _git_location(path: Path, timeout: float) -> git.Location | None:
    """Where git places `path`; None if it doesn't exist, or git can't tell."""
    if not path.exists():
        return None
    try:
        return git.locate(absolute(path), timeout)
    except git.GitError:
        return None


def _foreign_text(path: Path, location: git.Location, around: CheckoutDetails) -> str:
    """Why `path` is refused: git places it in a repository of its own inside `around`."""
    typed = absolute(path)
    top = displayed(typed, location.top)
    try:
        submodule = git.superproject(location.top) is not None
    except git.GitError:
        submodule = False
    kind, where = (
        ("Worktree", around.worktree.path)
        if around.worktree
        else ("Clone", around.clone.clone.display_path)
    )
    advice = f"run this in the {kind} at {where} instead"
    if typed.resolve() == location.top:
        what = f"{top} is a submodule" if submodule else f"{top} is a git repository of its own"
    else:
        what = f"{typed} is in the {'submodule' if submodule else 'git repository'} at {top}"
    if submodule:
        return f"{what}; {advice}"
    return f"{what}, not a Clone; {advice}, or add it with `hephaistos clone add`"


def _outdated(
    session: ReadSession, path: Path, checkout: CheckoutDetails | None, location: git.Location
) -> CloneDetails | None:
    """The Clone whose Checkout git places `path` in, if `checkout`, the record's, differs.

    Raises HephaistosError if git places it in a repository of its own inside `checkout`, e.g.
    a nested one or a submodule: git tells which repository a path is in.
    """
    if checkout is None:
        return at(session, location.main or location.top)
    known = checkout.worktree.path if checkout.worktree else checkout.clone.clone.resolved_path
    if known.resolve() == location.top:
        return None
    found = at(session, location.main or location.top)
    # Around it instead, git found another repository: the Checkout's own is gone.
    if found is None and location.top.is_relative_to(known.resolve()):
        raise HephaistosError(_foreign_text(path, location, checkout))
    return found


def find_checkout(
    session: ReadSession, path: Path, timeout: float = git.TIMEOUT
) -> CheckoutDetails:
    """The Checkout on this Machine that `path` lies in, as last observed.

    The innermost if they are nested, e.g. a Worktree inside its Clone's directory. Raises
    HephaistosError if git places `path` in a repository of its own inside it.
    """
    checkout = _recorded_checkout(session, path)
    if (location := _git_location(path, timeout)) is not None:
        _outdated(session, path, checkout, location)
    if checkout is None:
        raise HephaistosError(f"no Clone or Worktree known at {absolute(path)}")
    return checkout


def find(session: ReadSession, path: Path) -> CloneDetails:
    """The Clone that `path` lies in, or whose Worktree it lies in."""
    return find_checkout(session, path).clone


def outdated_clone(
    session: ReadSession, path: Path, timeout: float = git.TIMEOUT
) -> CloneDetails | None:
    """The Clone whose Checkout `path` lies in by git, if the record places it elsewhere.

    E.g. a Worktree not observed yet, or moved since. None if the record agrees with git, or git
    knows no Clone of ours there. Raises HephaistosError if git places `path` in a repository of
    its own inside a Checkout.
    """
    location = _git_location(path, timeout)
    if location is None:
        return None
    return _outdated(session, path, _recorded_checkout(session, path), location)


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


def remove_all(
    session: WriteSession, repository: Repository, expected: Collection[uuid.UUID]
) -> None:
    """Unregisters the Clones of `repository` on every Machine; their files stay untouched.

    They must be the `expected` ones, as confirmed by the user; else raises HephaistosError.
    """
    its_clones = details(session, repository_id=repository.id)
    if {existing.clone.id for existing in its_clones} != set(expected):
        raise HephaistosError(f"the Clones of {repository.name} changed meanwhile; try again")
    for existing in its_clones:
        records.delete(session, Table.REGISTRY_CLONES, EventKind.CLONE_DELETED, existing.clone)


@dataclass(frozen=True)
class Move:
    """A Clone, and the repository it was moved to."""

    clone: CloneDetails
    to: Candidate

    def place_of(self, inner: CloneDetails) -> Path:
        """Where a Clone inside this one is after the move, if it was moved along."""
        return self.to.display_path / inner.clone.resolved_path.relative_to(
            self.clone.clone.resolved_path
        )


def nested_clones(session: ReadSession, outer: CloneDetails) -> list[CloneDetails]:
    """The Clones on this Machine inside the directory of `outer`, sorted by path."""
    top = outer.clone.resolved_path
    return sorted(
        (
            inner
            for inner in on_this_machine(session)
            if inner.clone.resolved_path != top and inner.clone.resolved_path.is_relative_to(top)
        ),
        key=lambda inner: inner.clone.resolved_path,
    )


def _repair_text(moving: CloneDetails, to: Candidate, broken: Sequence[git.LinkedWorktree]) -> str:
    """Why a move is refused while Worktree links are broken, with the command repairing them."""
    old_top = moving.clone.resolved_path
    moved: list[str] = []
    unknown = False
    for linked in broken:
        if linked.path.exists():
            continue  # repaired from the Clone's side, without its path
        resolved = linked.path.resolve()
        if (
            resolved.is_relative_to(old_top)
            and (guess := to.display_path / resolved.relative_to(old_top)).is_dir()
        ):
            moved.append(shell_path(guess))
        else:
            moved.append(f"<new path of {shell_path(linked.path)}>")
            unknown = True
    shown = shell_path(to.display_path)
    repair = " ".join(["git", "-C", shown, "worktree", "repair", *moved])
    lines = [f"the links to Worktrees of {shown} are broken; repair them first:", repair]
    if unknown:
        lines.append(f"(for a deleted Worktree: git -C {shown} worktree prune)")
    return "\n  ".join(lines)


def _checked(session: ReadSession, moving: CloneDetails, path: Path) -> Move:
    """The move of `moving` to `path`, checked; raises HephaistosError if it can't be recorded."""
    old = moving.clone.resolved_path
    if old.is_dir():
        try:
            still = git.locate(old).top == old
        except git.GitError:
            still = False
        if still:
            raise HephaistosError(
                f"{moving.clone.display_path} is still a git repository;"
                " `clone move` records moves already made"
            )
    typed, location = _located(path)
    to = candidate(typed, location)
    _check_unregistered(session, to)
    if not git.shares_history(set(to.snapshot.root_commits), set(moving.state.root_commits)):
        raise HephaistosError(
            f"{to.display_path} shares no history with the Clone at {moving.clone.display_path}"
        )
    if broken := git.broken_worktrees(location.top, location.common_dir):
        raise HephaistosError(_repair_text(moving, to, broken))
    return Move(moving, to)


def moves(session: ReadSession, old: Path, new: Path, *, nested: bool = False) -> list[Move]:
    """The move of the Clone at `old` to `new`, checked; raises HephaistosError if not possible.

    With `nested`, also those of the Clones inside it, to the same places inside `new`.
    """
    checkout = find_checkout(session, old)
    if checkout.worktree is not None:
        raise HephaistosError(
            f"{absolute(old)} is in a Worktree of the Clone at"
            f" {checkout.clone.clone.display_path}; `git worktree move` moves Worktrees"
        )
    outer = checkout.clone
    found = [_checked(session, outer, new)]
    if nested:
        for inner in nested_clones(session, outer):
            try:
                found.append(_checked(session, inner, found[0].place_of(inner)))
            except HephaistosError as error:
                raise HephaistosError(
                    f"{error}\nmove {inner.clone.display_path} separately, or leave out --nested"
                ) from error
    return found


def move(session: WriteSession, planned: Sequence[Move]) -> None:
    """Records the checked moves; raises HephaistosError if a Clone changed meanwhile."""
    for moving in planned:
        old = moving.clone.clone
        current = at(session, old.resolved_path)
        if current is None or current.clone != old:
            raise HephaistosError(f"the Clone at {old.display_path} changed meanwhile; try again")
        _check_unregistered(session, moving.to)
        mount, _ = mounts.containing(session, session.machine_id, moving.to.resolved_path)
        new = dataclasses.replace(
            old,
            filesystem_id=mount.filesystem_id,
            resolved_path=moving.to.resolved_path,
            display_path=moving.to.display_path,
        )
        records.change(session, Table.REGISTRY_CLONES, EventKind.CLONE_MOVED, old, new)


def labels(session: ReadSession, ids: Collection[uuid.UUID]) -> dict[uuid.UUID, Path]:
    """How to show these Clones in place of their IDs: by path."""
    found = records.labels(session, Table.REGISTRY_CLONES, "display_path", ids)
    return {key: Path(value) for key, value in found.items()}
