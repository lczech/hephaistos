"""Observes the Clones on this Machine and their Worktrees: git first, then one write session."""

import logging
import time
import uuid
from collections.abc import Collection, Mapping
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from pathlib import Path
from typing import Self

from hephaistos.core import config
from hephaistos.core.db.sessions import read_session, write_session
from hephaistos.core.events.events import Event
from hephaistos.core.registry import clones
from hephaistos.core.state import activity
from hephaistos.core.state import clones as state
from hephaistos.core.state import worktrees as worktree_state
from hephaistos.core.state.activity import (
    BEGINNING,
    Activity,
    BranchOrigin,
    CheckoutActivity,
    CloneActivity,
    Cursor,
    Push,
)
from hephaistos.core.state.activity import CommittedPayload as Committed
from hephaistos.core.state.checkouts import Failed, Missing, same_state
from hephaistos.core.state.worktrees import WorktreeState
from hephaistos.core.utils import git
from hephaistos.core.utils.paths import Paths

PAGE = 64  # reflog entries read at first; more only if the cursor isn't among them

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Result:
    """What one observation did."""

    events: list[Event]
    observed: int  # Clones
    skipped: int  # Clones observed by another process meanwhile, or removed
    worktrees: int  # Worktrees observed, of the observed Clones
    updated: int  # Checkouts whose State changed, with or without Events


@dataclass(frozen=True)
class Known:
    """What the record holds about a Clone, so that observing reads only what is new."""

    path: Path
    observed_at: datetime  # last time, by this Machine's clock
    branches: frozenset[str]
    head_log: Cursor | None
    push_log: Mapping[str, Cursor] | None
    worktree_logs: Mapping[str, Cursor | None]  # by name
    removed_logs: Mapping[str, Cursor | None]  # of the last removed Worktree of each name

    @classmethod
    def of(cls, details: clones.CloneDetails, removed: Collection[WorktreeState] = ()) -> Self:
        """What the record holds about this Clone, and its `removed` Worktrees."""
        return cls(
            path=details.clone.resolved_path,
            observed_at=details.state.observed_at.datetime,
            branches=frozenset(details.state.branches),
            head_log=details.state.head_log,
            push_log=details.state.push_log,
            worktree_logs={worktree.name: worktree.head_log for worktree in details.worktrees},
            removed_logs={worktree.name: worktree.head_log for worktree in removed},
        )

    def worktree_log(self, name: str) -> Cursor | None:
        """Where to read a Worktree's HEAD reflog from.

        One found at the Clone's first observation starts at the end, like the Clone; one
        found later is new, so all of its reflog is.
        """
        if name in self.worktree_logs:
            return self.worktree_logs[name]
        return None if self.head_log is None else BEGINNING

    def removed_log(self, name: str) -> Cursor | None:
        """Where reading stopped for a removed Worktree of this name; None if there is none.

        Only for a name that no current Worktree has.
        """
        return None if name in self.worktree_logs else self.removed_logs.get(name)


def _unread(top: Path, cursor: Cursor) -> tuple[list[git.ReflogEntry], bool]:
    """The HEAD reflog's entries after `cursor`, oldest first, and whether its entry is there.

    If it isn't, e.g. expired, the entries after its time.
    """
    entries = git.reflog(top, limit=PAGE)
    found = activity.unread(entries, cursor)
    if found is None and len(entries) == PAGE:
        entries = git.reflog(top)
        found = activity.unread(entries, cursor)
    return (activity.newer(entries, cursor), False) if found is None else (found, True)


def _activity(entries: list[git.ReflogEntry], git_dir: Path, cursor: Cursor) -> CheckoutActivity:
    """The activity in a HEAD reflog's entries read after `cursor`, oldest first."""
    found, count = activity.activities(entries, rebasing=git.is_rebasing(git_dir))
    return CheckoutActivity(found, activity.cursor_after(entries[count - 1]) if count else cursor)


def _with_bodies(top: Path, read: CheckoutActivity) -> CheckoutActivity:
    """The activity with its commits' messages in full, as far as git still has them."""
    commits = {
        done.payload.head.new
        for done in read.activities
        if isinstance(done.payload, Committed) and isinstance(done.payload.head.new, str)
    }
    found = git.bodies(top, commits)

    def full(done: Activity) -> Activity:
        payload = done.payload
        if not isinstance(payload, Committed) or payload.head.new not in found:
            return done
        return replace(done, payload=replace(payload, body=found[str(payload.head.new)]))

    return replace(read, activities=[full(done) for done in read.activities])


def head_activity(top: Path, git_dir: Path, cursor: Cursor | None) -> CheckoutActivity:
    """What was done in the Checkout at `top` since `cursor`; HEAD must have a commit.

    Without a cursor, reading starts at the end: nothing was done yet.
    """
    if cursor is None:
        return CheckoutActivity((), activity.end(git.reflog(top, limit=1)))
    entries, _ = _unread(top, cursor)
    return _with_bodies(top, _activity(entries, git_dir, cursor))


def continued_activity(top: Path, git_dir: Path, cursor: Cursor) -> CheckoutActivity | None:
    """Like `head_activity`, but None unless the reflog still holds the cursor's entry.

    That tells whether a Checkout's history continues from the cursor.
    """
    entries, found = _unread(top, cursor)
    return _with_bodies(top, _activity(entries, git_dir, cursor)) if found else None


def push_activity(
    top: Path, cursors: Mapping[str, Cursor] | None
) -> tuple[list[Push], dict[str, Cursor]]:
    """The pushes since `cursors` (by remote-tracking ref), and where reading stopped.

    Without cursors, reading starts at the end; a ref without one is new, so all of it is
    unread, or what follows its remote's renaming.
    """
    by_ref: dict[str, list[git.ReflogEntry]] = {}
    for entry in git.remote_reflogs(top):
        by_ref.setdefault(entry.ref, []).append(entry)
    pushes: list[Push] = []
    for ref, entries in by_ref.items():
        if cursors is None:
            continue
        cursor = cursors.get(ref)
        if cursor is None:
            unread = activity.since_renamed(entries)
        else:
            found = activity.unread(entries, cursor)
            unread = activity.newer(entries, cursor) if found is None else found
        pushes += activity.pushes(unread)
    return pushes, {ref: activity.end(entries) for ref, entries in by_ref.items()}


# Reflog times are git's, maybe on another host sharing the Filesystem, and in seconds.
_CLOCK_SLACK = timedelta(minutes=1)


def _warn_of_old_pushes(path: Path, pushes: Collection[Push], observed_at: datetime) -> None:
    """Warns of pushes dated before the Clone's previous observation, which should have read them.

    Unless a clock is off, git listed old entries anew, as for an emptied symref's reflog.
    """
    old = [push.occurred_at for push in pushes if push.occurred_at < observed_at - _CLOCK_SLACK]
    if old:
        log.warning(
            "pushes in %s dated before its previous observation: %d, the oldest %s",
            path,
            len(old),
            min(old),
        )


def branch_origins(top: Path, branches: Collection[str]) -> dict[str, BranchOrigin]:
    """Where these branches came from, by their reflogs."""
    origins: dict[str, BranchOrigin] = {}
    for branch in branches:
        try:
            entries = git.reflog(top, f"refs/heads/{branch}")
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


def _failed(path: Path, error: Exception) -> Failed:
    """Why a Checkout failed, logged; errors git didn't report (likely bugs) with traceback."""
    if isinstance(error, git.GitError):
        log.warning("observing %s failed: %s", path, error)
        return Failed(str(error))
    log.error("observing %s failed unexpectedly", path, exc_info=error)
    return Failed(f"unexpected {type(error).__name__}: {error}")


def _log_observed(path: Path, observation: object, started: float) -> None:
    """Logs at debug level how observing a Checkout ended."""
    outcome = (
        "missing"
        if isinstance(observation, Missing)
        else "failed"
        if isinstance(observation, Failed)
        else "ok"
    )
    duration = round(time.monotonic() - started, 3)
    log.debug("observed %s", path, extra={"outcome": outcome, "duration": duration})


def _observed_clone(known: Known) -> CloneObservation:
    """`clone_observation`, raising GitError where git fails."""
    path = known.path
    if not path.is_dir():
        return CloneObservation(Missing())
    location = git.locate(path)
    if location.top != path:
        return CloneObservation(Missing())  # its repository is gone; git found one around it
    if location.main is not None:
        return CloneObservation(Failed(f"it is now a Worktree of {location.main}"))
    snapshot = git.snapshot(location)
    listed = git.worktrees(path, location.common_dir)
    if snapshot.head is None:
        read = CloneActivity((), known.head_log or BEGINNING, (), known.push_log or {}, {})
    else:
        head = head_activity(path, location.common_dir, known.head_log)
        pushes, push_cursors = push_activity(path, known.push_log)
        _warn_of_old_pushes(path, pushes, known.observed_at)
        origins = branch_origins(path, set(snapshot.branches) - known.branches)
        read = CloneActivity(head.activities, head.cursor, pushes, push_cursors, origins)
    return CloneObservation(snapshot, listed, location.common_dir, read)


def clone_observation(known: Known) -> CloneObservation:
    """A snapshot of a Clone with its Worktrees and git activity, or why there is none.

    Any error makes it failed, so that one Clone never stops observing the others.
    """
    started = time.monotonic()
    try:
        observed = _observed_clone(known)
    except git.NotInRepositoryError:
        observed = CloneObservation(Missing())
    except Exception as error:  # noqa: BLE001 - see the docstring
        observed = CloneObservation(_failed(known.path, error))
    _log_observed(known.path, observed.observation, started)
    return observed


@dataclass(frozen=True)
class WorktreeObservation:
    """What observing a Worktree gave: its status and activity, or why there are none."""

    observation: worktree_state.Observation
    read: CheckoutActivity | None = None
    restored: bool = False  # the removed Worktree of its name, as its history continues


def worktree_observation(
    linked: git.LinkedWorktree,
    git_dir: Path,
    cursor: Cursor | None,
    removed: Cursor | None = None,
) -> WorktreeObservation:
    """The status and git activity of a Worktree, or why there are none; any error fails it.

    `removed` is where reading stopped for a removed Worktree of the same name: if the
    reflog continues from there, it is that one, restored, and reading continues too.
    """
    started = time.monotonic()
    try:
        observed = _observed_worktree(linked, git_dir, cursor, removed)
    except Exception as error:  # noqa: BLE001 - one Worktree must not stop observing the others
        observed = WorktreeObservation(_failed(linked.path, error))
    _log_observed(linked.path, observed.observation, started)
    return observed


def _observed_worktree(
    linked: git.LinkedWorktree,
    git_dir: Path,
    cursor: Cursor | None,
    removed: Cursor | None,
) -> WorktreeObservation:
    """`worktree_observation`, raising GitError where git fails."""
    if not linked.path.is_dir():
        return WorktreeObservation(Missing())
    status = git.status(linked.path)
    if linked.head is None:
        return WorktreeObservation(status, CheckoutActivity((), cursor or BEGINNING))
    if removed is not None:
        read = continued_activity(linked.path, git_dir, removed)
        if read is not None:
            return WorktreeObservation(status, read, restored=True)
    return WorktreeObservation(status, head_activity(linked.path, git_dir, cursor))


def _updated(before: Collection[WorktreeState], after: Collection[WorktreeState]) -> int:
    """How many Worktrees were added, removed or changed between two readings of their State."""
    old = {state.id: state for state in before}
    new = {state.id: state for state in after}
    changed = sum(1 for id_, state in new.items() if id_ in old and not same_state(old[id_], state))
    return changed + len(old.keys() ^ new.keys())


def observe(
    paths: Paths,
    clone_ids: Collection[uuid.UUID] | None = None,
) -> Result:
    """Observes this Machine's Clones and their Worktrees, or those of the Clones in `clone_ids`.

    git runs outside any transaction: first for the Clones, then for all their Worktrees. A
    Clone that another process observed after we started keeps that fresher State; one moved
    meanwhile is left to the next observation, as its old path was observed. The
    Worktrees of a missing or failed Clone stay as last known.
    """
    with read_session(paths) as session:
        started = session.clock_value
        targets = [
            (
                existing.clone.id,
                Known.of(existing, worktree_state.removed_of(session, existing.clone.id).values()),
            )
            for existing in clones.on_this_machine(session)
            if clone_ids is None or existing.clone.id in clone_ids
        ]
    with ThreadPoolExecutor(max_workers=config.settings().observe.workers) as pool:
        looked = list(pool.map(clone_observation, [known for _, known in targets]))
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
                [known.removed_log(linked.name) for _, linked, _, known in jobs],
            )
        )
    by_clone: list[dict[str, WorktreeObservation]] = [{} for _ in targets]
    for (index, linked, _, _), observed in zip(jobs, observed_worktrees, strict=True):
        by_clone[index][linked.name] = observed

    recorded: list[Event] = []
    skipped = counted = updated = 0
    with write_session(paths) as session:
        current = {existing.clone.id: existing for existing in clones.details(session)}
        for index, (clone_id, target) in enumerate(targets):
            existing = current.get(clone_id)
            if (
                existing is None
                or existing.state.observed_at > started
                or existing.clone.resolved_path != target.path
            ):
                skipped += 1
                continue
            known = existing.state
            observed = looked[index]
            recorded += state.update(session, clone_id, observed.observation, observed.read)
            new = state.get(session, clone_id)
            if new is not None and not same_state(known, new):
                updated += 1
            listed = observed.worktrees
            if listed is not None and new is not None and new.present and new.error is None:
                worktrees = by_clone[index]
                before = worktree_state.of_clones(session, [clone_id])
                recorded += worktree_state.update(
                    session,
                    clone_id,
                    listed,
                    {name: worktree.observation for name, worktree in worktrees.items()},
                    read={
                        name: worktree.read
                        for name, worktree in worktrees.items()
                        if worktree.read is not None
                    },
                    restored={name for name, worktree in worktrees.items() if worktree.restored},
                )
                updated += _updated(before, worktree_state.of_clones(session, [clone_id]))
                counted += len(listed)
    return Result(
        events=recorded,
        observed=len(targets) - skipped,
        skipped=skipped,
        worktrees=counted,
        updated=updated,
    )


def observe_checkout(paths: Paths, path: Path, *, refresh: bool = False) -> Result | None:
    """Observes the Clone of the Checkout that `path` lies in, if needed; None if not.

    Needed if `refresh`, or if the record places `path` elsewhere than git does, e.g. in a
    Worktree not observed yet.
    """
    with read_session(paths) as session:
        clone = (
            clones.find_unobserved(session, path)
            if refresh
            else clones.outdated_clone(session, path)
        )
    return None if clone is None else observe(paths, [clone.clone.id])
