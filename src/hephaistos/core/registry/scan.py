"""Scanning a directory for git clones, to add them all at once.

Nothing is guessed: a clone that matches several Repositories, or whose new Repository's name is
taken, is skipped, with the commands that add it by hand.
"""

import dataclasses
import shlex
import uuid
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path

from hephaistos.core.db.sessions import ReadSession, WriteSession
from hephaistos.core.registry import clones, repositories
from hephaistos.core.registry.clones import Candidate, Histories
from hephaistos.core.utils import git
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.ids import new_id
from hephaistos.core.utils.paths import absolute, shell_path

DEPTH = 3  # directory levels searched below the scanned one


class Action(StrEnum):
    """What adding a plan does with a directory found by the scan."""

    JOIN = "join"  # adds it as a Clone of a Repository
    NEW = "new"  # adds it as a Clone of a new Repository, named after it
    OBSERVE = "observe"  # observes its Clone: a Worktree not observed yet
    SKIP = "skip"  # nothing, as adding it needs a choice
    KNOWN = "known"  # nothing: a Clone already, or an observed Worktree of one
    WORKTREE = "worktree"  # nothing of its own: a Worktree of a Clone in the plan
    UNREADABLE = "unreadable"  # nothing: a directory that could not be searched

    @property
    def is_quiet(self) -> bool:
        """Whether it needs no attention, so plans leave it out unless asked."""
        return self in {Action.KNOWN, Action.WORKTREE, Action.UNREADABLE}


@dataclass(frozen=True)
class Planned:
    """A directory found by a scan, and what adding the plan does with it."""

    path: Path  # as found, symlinks kept
    action: Action
    repository: str | None = None  # the Repository it joins, gets, or belongs to
    note: str = ""  # why it is skipped, or more about its action
    about: Path | None = None  # the Clone or Worktree the note names, shown after it
    fix: tuple[str, ...] = ()  # for a skip: the commands that add it by hand
    candidate: Candidate | None = None  # for join and new
    clone_id: uuid.UUID | None = None  # for observe: the Clone to observe


def _found(root: Path, depth: int) -> tuple[list[Path], list[tuple[Path, str]]]:
    """The directories with a `.git` entry at most `depth` levels below `root`, and the unreadable.

    Unreadable directories come with why. Doesn't descend into what it finds, nor into hidden
    directories. Follows symlinks after all else, so that a directory reached both ways is found
    by its real path; visits each directory once.
    """
    found: list[Path] = []
    unreadable: list[tuple[Path, str]] = []
    seen: set[Path] = set()
    links: list[tuple[Path, int]] = []  # grows while followed

    def visit(directory: Path, level: int) -> None:
        try:
            resolved = directory.resolve()
            if resolved in seen:
                return
            seen.add(resolved)
            if (directory / ".git").exists():
                found.append(directory)
                return
            if level == depth:
                return
            children = sorted(
                child
                for child in directory.iterdir()
                if not child.name.startswith(".") and child.is_dir()
            )
        except OSError as error:
            unreadable.append((directory, error.strerror or str(error)))
            return
        for child in children:
            if child.is_symlink():
                links.append((child, level + 1))
            else:
                visit(child, level + 1)

    visit(root, 0)
    for link, level in links:
        visit(link, level)
    return found, unreadable


def _add_by_hand(path: Path, repository: str = "<name>", *, new: bool = False) -> tuple[str, ...]:
    """The commands that add the clone at `path` to a Repository, after creating it if `new`."""
    name = repository if repository == "<name>" else shlex.quote(repository)
    created = (f"hephaistos repo add {name}",) if new else ()
    return (*created, f"hephaistos clone add {shell_path(path)} --repo {name}")


class _Planner:
    """Builds a plan from what a scan found, one directory after another."""

    def __init__(self, session: ReadSession) -> None:
        stored = clones.details(session)
        self.histories = Histories(stored)
        self.names = {existing.repository.id: existing.repository.name for existing in stored}
        self.clones = {
            existing.clone.resolved_path: existing for existing in clones.on_this_machine(session)
        }
        # Repositories by name, with their number of Clones.
        self.taken = {
            summary.repository.name: summary.clones for summary in repositories.summaries(session)
        }
        self.rows: list[Planned] = []
        self.planned: dict[Path, int] = {}  # resolved paths of Clones in the plan, by row
        self.new: dict[uuid.UUID, list[int]] = {}  # the rows of each new Repository, by key
        self.candidates: dict[int, Candidate] = {}  # of the new Repositories' rows
        self.ambiguous: dict[int, list[uuid.UUID]] = {}  # rows matching several, with those

    def add(self, row: Planned) -> int:
        """Adds a row to the plan; returns its index."""
        self.rows.append(row)
        return len(self.rows) - 1

    def clone(self, typed: Path, location: git.Location, worktree: Path | None = None) -> None:
        """Plans the Clone at `location`, found at `typed`, or through its `worktree`."""
        note = "for the Worktree" if worktree else ""
        top = location.top
        if (existing := self.clones.get(top)) is not None:
            self.add(Planned(typed, Action.KNOWN, existing.repository.name, "a Clone already"))
            return
        if top in self.planned:
            return
        if location.bare:
            skipped = Planned(
                typed,
                Action.SKIP,
                note="a bare repository; scans skip those",
                fix=_add_by_hand(typed),
            )
            self.planned[top] = self.add(skipped)
            return
        try:
            candidate = clones.candidate(typed, location)
        except git.GitError as error:
            self.planned[top] = self.add(Planned(typed, Action.SKIP, note=str(error)))
            return
        matches = self.histories.matching(candidate)
        if len(matches) > 1:
            # The note names them once the new Repositories are named.
            skipped = Planned(typed, Action.SKIP, fix=_add_by_hand(typed))
            self.planned[top] = index = self.add(skipped)
            self.ambiguous[index] = matches
            return
        key = matches[0] if matches else new_id()
        self.histories.include(key, candidate.snapshot.root_commits, candidate.snapshot.remotes)
        if key in self.names and key not in self.new:
            row = Planned(typed, Action.JOIN, self.names[key], note, worktree, candidate=candidate)
            self.planned[top] = self.add(row)
            return
        if not matches:
            self.names[key] = candidate.suggested_name  # until all are planned
            self.new[key] = []
        row = Planned(typed, Action.NEW, self.names[key], note, worktree, candidate=candidate)
        index = self.add(row)
        self.planned[top] = index
        self.new[key].append(index)
        self.candidates[index] = candidate

    def worktree(self, typed: Path, location: git.Location) -> None:
        """Plans the Worktree at `location`, found at `typed`: through its Clone."""
        main = location.main or location.top
        if (existing := self.clones.get(main)) is not None:
            shown = existing.clone.display_path
            repository = existing.repository.name
            if any(worktree.path.resolve() == location.top for worktree in existing.worktrees):
                self.add(Planned(typed, Action.KNOWN, repository, "a Worktree of", shown))
            else:
                row = Planned(
                    typed,
                    Action.OBSERVE,
                    repository,
                    "a new Worktree of",
                    shown,
                    clone_id=existing.clone.id,
                )
                self.add(row)
            return
        if main not in self.planned:
            if not main.is_dir():
                self.add(Planned(typed, Action.SKIP, note="its Clone is missing:", about=main))
                return
            try:
                main_location = git.locate(main)
            except git.GitError as error:
                self.add(Planned(typed, Action.SKIP, note=str(error)))
                return
            self.clone(main, main_location, typed)
        self.add(Planned(typed, Action.WORKTREE, note="a Worktree of", about=main))

    def _name(self, indexes: list[int]) -> str:
        """The name for a new Repository of these rows, sorted by path.

        From the first remote that isn't a path on this machine, else as the first clone suggests.
        """
        candidates = [self.candidates[index] for index in indexes]
        named = (candidate.remote_name for candidate in candidates if candidate.remote_name)
        return next(named, candidates[0].suggested_name)

    def finished(self) -> list[Planned]:
        """The plan, sorted by path, once the new Repositories are named and their names checked.

        A Repository without Clones is joined by name: it has no history to match by.
        """
        for key, indexes in self.new.items():
            indexes.sort(key=lambda index: str(self.rows[index].path))
            self.names[key] = self._name(indexes)
        for index, keys in self.ambiguous.items():
            names = sorted(self.names[key] for key in keys)
            self.rows[index] = dataclasses.replace(
                self.rows[index], note=f"matches {', '.join(names)}"
            )
        counts = Counter(self.names[key] for key in self.new)
        for key, indexes in self.new.items():
            name = self.names[key]
            empty = self.taken.get(name) == 0
            if counts[name] > 1:
                reason = f"{counts[name]} new Repositories would be named {name}"
            elif name in self.taken and not empty:
                reason = f"the name {name} is taken by an unrelated Repository"
            else:
                first = self.rows[indexes[0]].path
                for position, index in enumerate(indexes):
                    row = self.rows[index]
                    joining = empty or position > 0
                    row = dataclasses.replace(
                        row, action=Action.JOIN if joining else Action.NEW, repository=name
                    )
                    if position and not row.note and not empty:
                        row = dataclasses.replace(row, note="new, with", about=first)
                    self.rows[index] = row
                continue
            for index in indexes:
                row = self.rows[index]
                self.rows[index] = dataclasses.replace(
                    row,
                    action=Action.SKIP,
                    repository=None,
                    note=f"{reason}; {row.note}" if row.note else reason,
                    fix=_add_by_hand(row.path, name) if empty else _add_by_hand(row.path, new=True),
                    candidate=None,
                )
        return sorted(self.rows, key=lambda row: str(row.path))


def plan(session: ReadSession, root: Path, depth: int = DEPTH) -> list[Planned]:
    """What adding the git clones under `root` does, at most `depth` levels down.

    If `root` is a Clone or a Worktree, just that one; inside one, raises HephaistosError.
    """
    typed = absolute(root)
    if not typed.is_dir():
        raise HephaistosError(f"no such directory: {typed}")
    try:
        location = git.locate(typed)
    except git.NotInRepositoryError:
        found, unreadable = _found(typed, depth)
    else:
        if location.top != typed.resolve():
            kind = "Clone" if location.main is None else "Worktree"
            raise HephaistosError(
                f"{typed} is inside the {kind} at {location.top}; scan from outside it,"
                " or add a clone in it with `hephaistos clone add <path>`"
            )
        found, unreadable = [typed], []

    planner = _Planner(session)
    worktrees: list[tuple[Path, git.Location]] = []
    for path in found:
        try:
            location = git.locate(path)
        except git.GitError as error:
            planner.add(Planned(path, Action.SKIP, note=str(error)))
            continue
        if location.main is None:
            planner.clone(path, location)
        else:
            worktrees.append((path, location))
    # After the Clones, so that a Worktree's Clone is planned where it was found.
    for path, location in worktrees:
        planner.worktree(path, location)
    for path, reason in unreadable:
        planner.add(Planned(path, Action.UNREADABLE, note=reason))
    return planner.finished()


def add(
    session: WriteSession, planned: Sequence[Planned], *, import_history: bool = False
) -> list[uuid.UUID]:
    """Adds the planned Clones, after the new Repositories; returns the Clones' IDs."""
    adding: list[tuple[str, Candidate]] = []
    for row in planned:
        match row:
            case Planned(
                action=Action.NEW, repository=str() as name, candidate=Candidate() as candidate
            ):
                repositories.add(session, name)
                adding.append((name, candidate))
            case Planned(
                action=Action.JOIN, repository=str() as name, candidate=Candidate() as candidate
            ):
                adding.append((name, candidate))
            case _:
                pass
    return [
        clones.add(session, name, candidate, import_history=import_history).id
        for name, candidate in adding
    ]
