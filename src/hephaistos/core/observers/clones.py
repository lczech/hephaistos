"""Observes the Clones on this Machine: git first, then one write session for what changed."""

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
from hephaistos.core.state.checkouts import Failed, Missing
from hephaistos.core.utils import git
from hephaistos.core.utils.paths import Paths

WORKERS = 8  # git mostly waits for the disk, so a few run in parallel


@dataclass(frozen=True)
class Result:
    """What one observation did."""

    events: list[Event]
    observed: int
    skipped: int  # observed by another process meanwhile, or removed


def observation_of(path: Path, timeout: float = git.TIMEOUT) -> state.Observation:
    """A snapshot of the Clone at `path`, or why there is none."""
    if not path.is_dir():
        return Missing()
    try:
        location = git.locate(path, timeout)
        if location.top != path:
            return Missing()  # its repository is gone; git found one around it
        if location.main is not None:
            return Failed(f"it is now a Worktree of {location.main}")
        return git.snapshot(path, timeout)
    except git.NotInRepositoryError:
        return Missing()
    except git.GitError as error:
        return Failed(str(error))


def observe(
    paths: Paths,
    clone_ids: Collection[uuid.UUID] | None = None,
    *,
    timeout: float = git.TIMEOUT,
) -> Result:
    """Observes this Machine's Clones, or those among them in `clone_ids`.

    git runs outside any transaction. A Clone that another process observed after we started
    keeps that fresher State.
    """
    with read_session(paths) as session:
        started = session.clock_value
        targets = [
            (existing.clone.id, existing.clone.resolved_path)
            for existing in clones.on_this_machine(session)
            if clone_ids is None or existing.clone.id in clone_ids
        ]
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        observations = list(
            pool.map(observation_of, [path for _, path in targets], repeat(timeout))
        )

    recorded: list[Event] = []
    skipped = 0
    with write_session(paths) as session:
        current = {existing.clone.id: existing.state for existing in clones.details(session)}
        for (clone_id, _), observation in zip(targets, observations, strict=True):
            known = current.get(clone_id)
            if known is None or known.observed_at > started:
                skipped += 1
                continue
            recorded += state.update(session, clone_id, observation)
    return Result(events=recorded, observed=len(targets) - skipped, skipped=skipped)
