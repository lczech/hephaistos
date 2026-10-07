"""Observes the Clones on this Machine and their Worktrees: git first, then one write session."""

import uuid
from collections.abc import Collection, Mapping
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from itertools import repeat
from pathlib import Path
from typing import Self

from hephaistos.core.db.sessions import read_session, write_session
from hephaistos.core.events.events import Event
from hephaistos.core.registry import clones
from hephaistos.core.state import activity
from hephaistos.core.state import clones as state
from hephaistos.core.state import worktrees as worktree_state
from hephaistos.core.state.activity import (
    BEGINNING,
    BranchOrigin,
    CheckoutActivity,
    CloneActivity,
    Cursor,
    Push,
)
from hephaistos.core.state.checkouts import Failed, Missing
from hephaistos.core.utils import git
from hephaistos.core.utils.paths import Paths

WORKERS = 8  # git mostly waits for the disk, so a few run in parallel
PAGE = 64  # reflog entries read at first; more only if the cursor isn't among them


@dataclass(frozen=True)
class Result:
    """What one observation did."""

    events: list[Event]
    observed: int  # Clones
    skipped: int  # Clones observed by another process meanwhile, or removed
    worktrees: int  # Worktrees observed, of the observed Clones


@dataclass(frozen=True)
class Known:
    """What the record holds about a Clone, so that observing reads only what is new."""

    path: Path
    branches: frozenset[str]
    head_log: Cursor | None
    push_log: Mapping[str, Cursor] | None
    worktree_logs: Mapping[str, Cursor | None]  # by name

    @classmethod
    def of(cls, details: clones.CloneDetails) -> Self:
        """What the record holds about this Clone."""
        return cls(
            path=details.clone.resolved_path,
            branches=frozenset(details.state.branches),
            head_log=details.state.head_log,
            push_log=details.state.push_log,
            worktree_logs={worktree.name: worktree.head_log for worktree in details.worktrees},
        )

    def worktree_log(self, name: str) -> Cursor | None:
        """Where to read a Worktree's HEAD reflog from.

        One found at the Clone's first observation starts at the end, like the Clone; one
        found later is new, so all of its reflog is.
        """
        if name in self.worktree_logs:
            return self.worktree_logs[name]
        return None if self.head_log is None else BEGINNING


def _unread(top: Path, cursor: Cursor, timeout: float) -> list[git.ReflogEntry]:
    """The HEAD reflog's entries after `cursor`, oldest first."""
    entries = git.reflog(top, limit=PAGE, timeout=timeout)
    found = activity.unread(entries, cursor)
    if found is None and len(entries) == PAGE:
        entries = git.reflog(top, timeout=timeout)
        found = activity.unread(entries, cursor)
    return activity.newer(entries, cursor) if found is None else found


def head_activity(
    top: Path, git_dir: Path, cursor: Cursor | None, timeout: float = git.TIMEOUT
) -> CheckoutActivity:
    """What was done in the Checkout at `top` since `cursor`; HEAD must have a commit.

    Without a cursor, reading starts at the end: nothing was done yet.
    """
    if cursor is None:
        return CheckoutActivity((), activity.end(git.reflog(top, limit=1, timeout=timeout)))
    entries = _unread(top, cursor, timeout)
    found, count = activity.activities(entries, rebasing=git.is_rebasing(git_dir))
    return CheckoutActivity(found, activity.cursor_after(entries[count - 1]) if count else cursor)


def push_activity(
    top: Path, cursors: Mapping[str, Cursor] | None, timeout: float = git.TIMEOUT
) -> tuple[list[Push], dict[str, Cursor]]:
    """The pushes since `cursors` (by remote-tracking ref), and where reading stopped.

    Without cursors, reading starts at the end; a ref without one is new, so all of it is.
    """
    by_ref: dict[str, list[git.ReflogEntry]] = {}
    for entry in git.remote_reflogs(top, timeout):
        by_ref.setdefault(entry.ref, []).append(entry)
    pushes: list[Push] = []
    for ref, entries in by_ref.items():
        if cursors is not None:
            cursor = cursors.get(ref, BEGINNING)
            found = activity.unread(entries, cursor)
            pushes += activity.pushes(activity.newer(entries, cursor) if found is None else found)
    return pushes, {ref: activity.end(entries) for ref, entries in by_ref.items()}


def branch_origins(
    top: Path, branches: Collection[str], timeout: float = git.TIMEOUT
) -> dict[str, BranchOrigin]:
    """Where these branches came from, by their reflogs."""
    origins: dict[str, BranchOrigin] = {}
    for branch in branches:
        try:
            entries = git.reflog(top, f"refs/heads/{branch}", timeout=timeout)
        except git.GitError:
            continue  # deleted meanwhile
        origins[branch] = activity.branch_origin(branch, entries)
    return origins


@dataclass(frozen=True)
class CloneObservation:
    """What observing a Clone gave: git's facts, or why there are none."""

    observation: state.Observation
    worktrees: tuple[git.LinkedWorktree, ...] | None = None
    common_dir: Path | None = None
    read: CloneActivity | None = None


def clone_observation(known: Known, timeout: float = git.TIMEOUT) -> CloneObservation:
    """A snapshot of a Clone with its Worktrees and git activity, or why there is none."""
    path = known.path
    if not path.is_dir():
        return CloneObservation(Missing())
    try:
        location = git.locate(path, timeout)
        if location.top != path:
            return CloneObservation(Missing())  # its repository is gone; git found one around it
        if location.main is not None:
            return CloneObservation(Failed(f"it is now a Worktree of {location.main}"))
        snapshot = git.snapshot(path, timeout)
        listed = git.worktrees(path, location.common_dir, timeout)
        if snapshot.head is None:
            read = CloneActivity((), known.head_log or BEGINNING, (), known.push_log or {}, {})
        else:
            head = head_activity(path, location.common_dir, known.head_log, timeout)
            pushes, push_cursors = push_activity(path, known.push_log, timeout)
            origins = branch_origins(path, set(snapshot.branches) - known.branches, timeout)
            read = CloneActivity(head.activities, head.cursor, pushes, push_cursors, origins)
    except git.NotInRepositoryError:
        return CloneObservation(Missing())
    except git.GitError as error:
        return CloneObservation(Failed(str(error)))
    return CloneObservation(snapshot, listed, location.common_dir, read)


@dataclass(frozen=True)
class WorktreeObservation:
    """What observing a Worktree gave: its status and activity, or why there are none."""

    observation: worktree_state.Observation
    read: CheckoutActivity | None = None


def worktree_observation(
    linked: git.LinkedWorktree, git_dir: Path, cursor: Cursor | None, timeout: float = git.TIMEOUT
) -> WorktreeObservation:
    """The status and git activity of a Worktree, or why there are none."""
    if not linked.path.is_dir():
        return WorktreeObservation(Missing())
    try:
        status = git.status(linked.path, timeout)
        if linked.head is None:
            return WorktreeObservation(status, CheckoutActivity((), cursor or BEGINNING))
        return WorktreeObservation(status, head_activity(linked.path, git_dir, cursor, timeout))
    except git.GitError as error:
        return WorktreeObservation(Failed(str(error)))


def observe(
    paths: Paths,
    clone_ids: Collection[uuid.UUID] | None = None,
    *,
    timeout: float = git.TIMEOUT,
) -> Result:
    """Observes this Machine's Clones and their Worktrees, or those of the Clones in `clone_ids`.

    git runs outside any transaction: first for the Clones, then for all their Worktrees. A
    Clone that another process observed after we started keeps that fresher State. The
    Worktrees of a missing or failed Clone stay as last known.
    """
    with read_session(paths) as session:
        started = session.clock_value
        targets = [
            (existing.clone.id, Known.of(existing))
            for existing in clones.on_this_machine(session)
            if clone_ids is None or existing.clone.id in clone_ids
        ]
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        looked = list(pool.map(clone_observation, [known for _, known in targets], repeat(timeout)))
        jobs = [
            (index, linked, observed.common_dir or Path(), targets[index][1])
            for index, observed in enumerate(looked)
            for linked in observed.worktrees or ()
        ]
        observed_worktrees = list(
            pool.map(
                worktree_observation,
                [linked for _, linked, _, _ in jobs],
                [common / "worktrees" / linked.name for _, linked, common, _ in jobs],
                [known.worktree_log(linked.name) for _, linked, _, known in jobs],
                repeat(timeout),
            )
        )
    by_clone: list[dict[str, WorktreeObservation]] = [{} for _ in targets]
    for (index, linked, _, _), observed in zip(jobs, observed_worktrees, strict=True):
        by_clone[index][linked.name] = observed

    recorded: list[Event] = []
    skipped = counted = 0
    with write_session(paths) as session:
        current = {existing.clone.id: existing.state for existing in clones.details(session)}
        for index, (clone_id, _) in enumerate(targets):
            known = current.get(clone_id)
            if known is None or known.observed_at > started:
                skipped += 1
                continue
            observed = looked[index]
            recorded += state.update(session, clone_id, observed.observation, observed.read)
            new = state.get(session, clone_id)
            listed = observed.worktrees
            if listed is not None and new is not None and new.present and new.error is None:
                worktrees = by_clone[index]
                recorded += worktree_state.update(
                    session,
                    clone_id,
                    listed,
                    {name: worktree.observation for name, worktree in worktrees.items()},
                    {
                        name: worktree.read
                        for name, worktree in worktrees.items()
                        if worktree.read is not None
                    },
                )
                counted += len(listed)
    return Result(
        events=recorded,
        observed=len(targets) - skipped,
        skipped=skipped,
        worktrees=counted,
    )


def observe_checkout(
    paths: Paths, path: Path, *, refresh: bool = False, timeout: float = git.TIMEOUT
) -> Result | None:
    """Observes the Clone of the Checkout that `path` lies in, if needed; None if not.

    Needed if `refresh`, or if the record places `path` elsewhere than git does, e.g. in a
    Worktree not observed yet.
    """
    with read_session(paths) as session:
        clone = (
            clones.find_unobserved(session, path, timeout)
            if refresh
            else clones.outdated_clone(session, path, timeout)
        )
    return None if clone is None else observe(paths, [clone.clone.id], timeout=timeout)
