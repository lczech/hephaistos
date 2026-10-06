"""Worktrees' State: found by observing their Clone, identified by Clone and git's admin name."""

import dataclasses
import sqlite3
import uuid
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Self

from hephaistos.core.db.sessions import ReadSession, WriteSession, chunks
from hephaistos.core.events import events
from hephaistos.core.events.events import Change, Event
from hephaistos.core.events.kinds import EventKind
from hephaistos.core.state.checkouts import (
    STATUS_COLUMNS,
    CheckoutState,
    Condition,
    Failed,
    Missing,
    conditions,
    status_values,
)
from hephaistos.core.utils import git
from hephaistos.core.utils.ids import Timestamp, new_id


@dataclass(frozen=True, kw_only=True)
class WorktreeState(CheckoutState):
    """What was last observed about a Worktree."""

    id: uuid.UUID
    clone_id: uuid.UUID
    name: str  # git's admin name; kept when moved
    path: Path
    lock_reason: str | None  # None unless locked; empty if locked without a reason

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> Self:
        """Builds a WorktreeState from a database row with its columns."""
        return cls(
            id=uuid.UUID(bytes=row["id"]),
            clone_id=uuid.UUID(bytes=row["clone_id"]),
            name=row["name"],
            path=Path(row["path"]),
            lock_reason=row["lock_reason"],
            observed_at=Timestamp(row["observed_at"]),
            observed_by=uuid.UUID(bytes=row["observed_by"]),
            present=bool(row["present"]),
            error=row["error"],
            head=row["head"],
            branch=row["branch"],
            **{column: row[column] for column in STATUS_COLUMNS},
        )


COLUMNS = (
    "id",
    "clone_id",
    "name",
    "path",
    "lock_reason",
    "observed_at",
    "observed_by",
    "present",
    "head",
    "branch",
    *STATUS_COLUMNS,
    "error",
)

# What observing one Worktree's directory can give.
type Observation = git.Status | Missing | Failed


@dataclass(frozen=True)
class WorktreePayload:
    """The payload of `worktree.missing`, `.found` and `.recovered`; the others extend it."""

    clone_id: uuid.UUID
    path: Path


@dataclass(frozen=True)
class ListedPayload(WorktreePayload):
    """The payload of `worktree.added` and `worktree.removed`."""

    branch: str | None


@dataclass(frozen=True)
class FailedPayload(WorktreePayload):
    """The payload of `worktree.failed`."""

    error: str


@dataclass(frozen=True)
class MovedPayload:
    """The payload of `worktree.moved`."""

    clone_id: uuid.UUID
    path: Change


def of_clones(
    session: ReadSession, clone_ids: Collection[uuid.UUID] | None = None
) -> list[WorktreeState]:
    """The Worktrees of these Clones, or of all, sorted by path."""
    if clone_ids is None:
        rows = list(session.conn.execute(f"SELECT {', '.join(COLUMNS)} FROM state_worktrees"))  # noqa: S608 - our own constant
    else:
        rows = [
            row
            for chunk in chunks(clone_ids)
            for row in session.conn.execute(
                f"SELECT {', '.join(COLUMNS)} FROM state_worktrees"  # noqa: S608 - our own constant; values are parameters
                f" WHERE clone_id IN ({', '.join('?' * len(chunk))})",
                chunk,
            )
        ]
    return sorted((WorktreeState.from_row(row) for row in rows), key=lambda state: state.path)


def _write(session: WriteSession, state: WorktreeState) -> None:
    """Stores a Worktree's State, replacing the previous one."""
    values = {column: getattr(state, column) for column in COLUMNS}
    session.conn.execute(
        f"INSERT OR REPLACE INTO state_worktrees ({', '.join(COLUMNS)})"  # noqa: S608 - our own constant
        f" VALUES ({', '.join('?' * len(COLUMNS))})",
        tuple(values.values()),
    )


def _state_from(
    session: WriteSession,
    clone_id: uuid.UUID,
    old: WorktreeState | None,
    linked: git.LinkedWorktree,
    observation: Observation,
) -> WorktreeState:
    """The State that git's listing and an observation taken now give.

    When missing or failed, the status stays as last known.
    """
    base = old or WorktreeState(
        id=new_id(),
        clone_id=clone_id,
        name=linked.name,
        path=linked.path,
        lock_reason=linked.lock_reason,
        observed_at=Timestamp(0),
        observed_by=session.machine_id,
        present=True,
        error=None,
        head=linked.head,
        branch=linked.branch,
        **status_values(None),
    )
    listed = dataclasses.replace(
        base,
        path=linked.path,
        lock_reason=linked.lock_reason,
        head=linked.head,
        branch=linked.branch,
        observed_at=session.tick(),
        observed_by=session.machine_id,
    )
    match observation:
        case Missing():
            return dataclasses.replace(listed, present=False, error=None)
        case Failed(error):
            return dataclasses.replace(listed, present=True, error=error)
        case git.Status():
            return dataclasses.replace(
                listed, present=True, error=None, **status_values(observation)
            )


def _condition_payload(condition: Condition, state: WorktreeState) -> WorktreePayload:
    """The payload of a `worktree.<condition>` Event."""
    if condition is Condition.FAILED:
        return FailedPayload(state.clone_id, state.path, state.error or "")
    return WorktreePayload(state.clone_id, state.path)


def update(
    session: WriteSession,
    clone_id: uuid.UUID,
    listed: Sequence[git.LinkedWorktree],
    observations: Mapping[str, Observation],
) -> list[Event]:
    """Stores what observing a Clone's Worktrees gave, and records the Events it causes.

    `observations` holds, by name, those of the listed Worktrees whose directories exist. One
    whose directory is gone was removed, unless it is locked: then it is missing.
    """
    known = {state.name: state for state in of_clones(session, [clone_id])}
    recorded: list[Event] = []

    def record(kind: EventKind, subject: uuid.UUID, payload: object) -> None:
        recorded.append(events.record(session, kind, subject, payload))

    def remove(state: WorktreeState) -> None:
        session.conn.execute("DELETE FROM state_worktrees WHERE id = ?", (state.id,))
        record(
            EventKind.WORKTREE_REMOVED,
            state.id,
            ListedPayload(clone_id, state.path, state.branch),
        )

    for linked in listed:
        old = known.pop(linked.name, None)
        observation = observations.get(linked.name, Missing())
        if isinstance(observation, Missing) and linked.lock_reason is None:
            if old is not None:
                remove(old)
            continue
        new = _state_from(session, clone_id, old, linked, observation)
        _write(session, new)
        if old is None:
            record(EventKind.WORKTREE_ADDED, new.id, ListedPayload(clone_id, new.path, new.branch))
            continue
        if old.path.resolve() != new.path.resolve():
            record(
                EventKind.WORKTREE_MOVED, new.id, MovedPayload(clone_id, Change(old.path, new.path))
            )
        for condition in conditions(old, new):
            record(EventKind(f"worktree.{condition}"), new.id, _condition_payload(condition, new))
    for old in known.values():
        remove(old)
    return recorded


def labels(session: ReadSession, ids: Collection[uuid.UUID]) -> dict[uuid.UUID, Path]:
    """How to show these Worktrees in place of their IDs: by path.

    Removed Worktrees have no State left; they show the last path an Event recorded.
    """
    found: dict[uuid.UUID, Path] = {}
    for chunk in chunks(ids):
        placeholders = ", ".join("?" * len(chunk))
        rows = session.conn.execute(
            f"SELECT id, path FROM state_worktrees WHERE id IN ({placeholders})",  # noqa: S608 - placeholders only
            chunk,
        )
        found |= {uuid.UUID(bytes=row[0]): Path(row[1]) for row in rows}
    for chunk in chunks([id_ for id_ in ids if id_ not in found]):
        placeholders = ", ".join("?" * len(chunk))
        rows = session.conn.execute(
            # A moved Worktree's payload has the path as {old, new}.
            "SELECT subject, coalesce(json_extract(payload, '$.path.new'),"  # noqa: S608 - placeholders only
            " json_extract(payload, '$.path')) FROM events"
            f" WHERE subject IN ({placeholders}) AND kind GLOB 'worktree.*'"
            " ORDER BY recorded_at",
            chunk,
        )
        found |= {uuid.UUID(bytes=row[0]): Path(row[1]) for row in rows if row[1] is not None}
    return found
