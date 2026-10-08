"""Worktrees' State: found by observing their Clone, identified by Clone and git's admin name."""

import dataclasses
import sqlite3
import uuid
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Self

from hephaistos.core.db import values
from hephaistos.core.db.sessions import ReadSession, WriteSession, chunks
from hephaistos.core.events import events
from hephaistos.core.events.events import Caused, Change, Event
from hephaistos.core.events.kinds import EventKind
from hephaistos.core.state import activity, checkouts
from hephaistos.core.state.activity import ActivityPayload, CheckoutActivity, Cursor
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

#: The columns of `state_worktrees`, decoded for raw views.
DECODERS = checkouts.DECODERS | {
    "id": values.uuid_bytes,
    "clone_id": values.uuid_bytes,
    "name": values.plain,
    "path": values.plain,
    "lock_reason": values.plain,
    "removed": values.plain,
}


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
            head_log=None if row["head_log"] is None else Cursor.from_text(row["head_log"]),
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
    "head_log",
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
    """The payload of `worktree.added`, `.removed` and `.restored`."""

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
    """The Worktrees of these Clones, or of all, sorted by path; removed ones left out."""
    select = f"SELECT {', '.join(COLUMNS)} FROM state_worktrees WHERE removed = 0"  # noqa: S608 - our own constant
    if clone_ids is None:
        rows = list(session.conn.execute(select))
    else:
        rows = [
            row
            for chunk in chunks(clone_ids)
            for row in session.conn.execute(
                f"{select} AND clone_id IN ({', '.join('?' * len(chunk))})",
                chunk,
            )
        ]
    return sorted((WorktreeState.from_row(row) for row in rows), key=lambda state: state.path)


def removed_of(session: ReadSession, clone_id: uuid.UUID) -> dict[str, WorktreeState]:
    """The Clone's removed Worktrees by name: of each name, the last observed."""
    rows = session.conn.execute(
        f"SELECT {', '.join(COLUMNS)} FROM state_worktrees"  # noqa: S608 - our own constant
        " WHERE clone_id = ? AND removed = 1 ORDER BY observed_at",
        (clone_id,),
    )
    return {row["name"]: WorktreeState.from_row(row) for row in rows}


def _write(session: WriteSession, state: WorktreeState) -> None:
    """Stores a Worktree's State, replacing the previous one."""
    values = {column: getattr(state, column) for column in COLUMNS} | {
        "head_log": None if state.head_log is None else state.head_log.to_text()
    }
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
        head_log=None,
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


def _activity_payload(clone_id: uuid.UUID, payload: ActivityPayload) -> dict[str, object]:
    """A git activity payload for a Worktree: with its Clone, as other Worktree Events have."""
    fields = {field.name: getattr(payload, field.name) for field in dataclasses.fields(payload)}
    return {"clone_id": clone_id, **fields}


def caused_events(
    old: WorktreeState | None,
    new: WorktreeState,
    read: CheckoutActivity | None,
    *,
    restored: bool = False,
) -> list[Caused]:
    """The Events that going from `old` (None if new) to `new` causes, and its git activity.

    If `restored`, `old` is the removed Worktree that `new` turned out to be.
    """
    clone_id = new.clone_id
    listed = ListedPayload(clone_id, new.path, new.branch)
    if old is None:
        caused = [Caused(EventKind.WORKTREE_ADDED, listed)]
    else:
        caused = [
            Caused(EventKind(f"worktree.{condition}"), _condition_payload(condition, new))
            for condition in conditions(old, new)
        ]
        if old.path.resolve() != new.path.resolve():
            moved = MovedPayload(clone_id, Change(old.path, new.path))
            caused.insert(0, Caused(EventKind.WORKTREE_MOVED, moved))
        if restored:
            caused.insert(0, Caused(EventKind.WORKTREE_RESTORED, listed))
    caused += [
        Caused(
            EventKind(f"worktree.{done.kind}"),
            _activity_payload(clone_id, done.payload),
            done.occurred_at,
            activity.key(clone_id, new.name, "HEAD", done.occurred_at, done.payload.head),
        )
        for done in (read.activities if read else ())
    ]
    return caused


def update(  # noqa: PLR0913 - the optional ones are keyword-only
    session: WriteSession,
    clone_id: uuid.UUID,
    listed: Sequence[git.LinkedWorktree],
    observations: Mapping[str, Observation],
    *,
    read: Mapping[str, CheckoutActivity] | None = None,
    restored: Collection[str] = (),
) -> list[Event]:
    """Stores what observing a Clone's Worktrees gave, and records the Events it causes.

    `observations` holds, by name, those of the listed Worktrees whose directories exist. One
    whose directory is gone was removed, unless it is locked: then it is missing. Removed
    Worktrees stay as rows, for their Events. `read` holds, by name, what reading their HEAD
    reflogs gave. `restored` names those that are the last removed Worktree of their name, as
    their history continues from it: they get its row back.
    """
    read = read or {}
    known = {state.name: state for state in of_clones(session, [clone_id])}
    removed = removed_of(session, clone_id) if restored else {}
    recorded: list[Event] = []

    def remove(state: WorktreeState) -> None:
        session.conn.execute("UPDATE state_worktrees SET removed = 1 WHERE id = ?", (state.id,))
        payload = ListedPayload(clone_id, state.path, state.branch)
        recorded.append(events.record(session, EventKind.WORKTREE_REMOVED, state.id, payload))

    for linked in listed:
        old = known.pop(linked.name, None)
        observation = observations.get(linked.name, Missing())
        if isinstance(observation, Missing) and linked.lock_reason is None:
            if old is not None:
                remove(old)
            continue
        restoring = old is None and linked.name in restored and linked.name in removed
        if restoring:
            old = removed[linked.name]
        new = _state_from(session, clone_id, old, linked, observation)
        done = read.get(linked.name) if new.present and new.error is None else None
        if done is not None:
            new = dataclasses.replace(new, head_log=done.cursor)
        _write(session, new)  # also clears `removed`, which it doesn't write
        recorded += [
            events.record(
                session,
                event.kind,
                new.id,
                event.payload,
                occurred_at=event.occurred_at,
                key=event.key,
            )
            for event in caused_events(old, new, done, restored=restoring)
        ]
    for old in known.values():
        remove(old)
    return recorded


def labels(session: ReadSession, ids: Collection[uuid.UUID]) -> dict[uuid.UUID, Path]:
    """How to show these Worktrees in place of their IDs: by path, the last one if removed."""
    found: dict[uuid.UUID, Path] = {}
    for chunk in chunks(ids):
        placeholders = ", ".join("?" * len(chunk))
        rows = session.conn.execute(
            f"SELECT id, path FROM state_worktrees WHERE id IN ({placeholders})",  # noqa: S608 - placeholders only
            chunk,
        )
        found |= {uuid.UUID(bytes=row[0]): Path(row[1]) for row in rows}
    return found
