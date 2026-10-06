"""Observes the Clones on this Machine and their Worktrees: git first, then one write session."""

import uuid
from collections.abc import Collection
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from itertools import repeat
from pathlib import Path

from hephaistos.core.db.sessions import read_session, write_session
from hephaistos.core.events.events import Event
from hephaistos.core.registry import clones
from hephaistos.core.state import clones as state
from hephaistos.core.state import worktrees as worktree_state
from hephaistos.core.state.checkouts import Failed, Missing
from hephaistos.core.utils import git
from hephaistos.core.utils.paths import Paths

WORKERS = 8  # git mostly waits for the disk, so a few run in parallel


@dataclass(frozen=True)
class Result:
    """What one observation did."""

    events: list[Event]
    observed: int  # Clones
    skipped: int  # Clones observed by another process meanwhile, or removed
    worktrees: int  # Worktrees observed, of the observed Clones


def clone_observation(
    path: Path, timeout: float = git.TIMEOUT
) -> tuple[state.Observation, tuple[git.LinkedWorktree, ...] | None]:
    """A snapshot of the Clone at `path` with its Worktrees, or why there is none."""
    if not path.is_dir():
        return Missing(), None
    try:
        location = git.locate(path, timeout)
        if location.top != path:
            return Missing(), None  # its repository is gone; git found one around it
        if location.main is not None:
            return Failed(f"it is now a Worktree of {location.main}"), None
        snapshot = git.snapshot(path, timeout)
        return snapshot, git.worktrees(path, location.common_dir, timeout)
    except git.NotInRepositoryError:
        return Missing(), None
    except git.GitError as error:
        return Failed(str(error)), None


def worktree_observation(path: Path, timeout: float = git.TIMEOUT) -> worktree_state.Observation:
    """The status of the Worktree at `path`, or why there is none."""
    if not path.is_dir():
        return Missing()
    try:
        return git.status(path, timeout)
    except git.GitError as error:
        return Failed(str(error))


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
            (existing.clone.id, existing.clone.resolved_path)
            for existing in clones.on_this_machine(session)
            if clone_ids is None or existing.clone.id in clone_ids
        ]
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        looked = list(pool.map(clone_observation, [path for _, path in targets], repeat(timeout)))
        jobs = [
            (index, linked) for index, (_, listed) in enumerate(looked) for linked in listed or ()
        ]
        statuses = list(
            pool.map(worktree_observation, [linked.path for _, linked in jobs], repeat(timeout))
        )
    by_clone: list[dict[str, worktree_state.Observation]] = [{} for _ in targets]
    for (index, linked), status in zip(jobs, statuses, strict=True):
        by_clone[index][linked.name] = status

    recorded: list[Event] = []
    skipped = observed_worktrees = 0
    with write_session(paths) as session:
        current = {existing.clone.id: existing.state for existing in clones.details(session)}
        for index, (clone_id, _) in enumerate(targets):
            known = current.get(clone_id)
            if known is None or known.observed_at > started:
                skipped += 1
                continue
            observation, listed = looked[index]
            recorded += state.update(session, clone_id, observation)
            new = state.get(session, clone_id)
            if listed is not None and new is not None and new.present and new.error is None:
                recorded += worktree_state.update(session, clone_id, listed, by_clone[index])
                observed_worktrees += len(listed)
    return Result(
        events=recorded,
        observed=len(targets) - skipped,
        skipped=skipped,
        worktrees=observed_worktrees,
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
