"""A Clone's State: what was last observed about it, and the Events its changes cause."""

import dataclasses
import json
import sqlite3
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Self

from hephaistos.core.db.sessions import ReadSession, WriteSession
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
from hephaistos.core.utils.ids import Timestamp


@dataclass(frozen=True, kw_only=True)
class CloneState(CheckoutState):
    """What was last observed about a Clone."""

    clone_id: uuid.UUID
    bare: bool
    root_commits: tuple[str, ...]
    remotes: Mapping[str, str]
    branches: tuple[str, ...]

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> Self:
        """Builds a CloneState from a database row with its columns."""
        return cls(
            clone_id=uuid.UUID(bytes=row["clone_id"]),
            observed_at=Timestamp(row["observed_at"]),
            observed_by=uuid.UUID(bytes=row["observed_by"]),
            present=bool(row["present"]),
            error=row["error"],
            bare=bool(row["bare"]),
            head=row["head"],
            branch=row["branch"],
            **{column: row[column] for column in STATUS_COLUMNS},
            root_commits=tuple(json.loads(row["root_commits"])),
            remotes=json.loads(row["remotes"]),
            branches=tuple(json.loads(row["branches"])),
        )


COLUMNS = (
    "clone_id",
    "observed_at",
    "observed_by",
    "present",
    "bare",
    "head",
    "branch",
    *STATUS_COLUMNS,
    "root_commits",
    "remotes",
    "branches",
    "error",
)

# What observing a Clone can give.
type Observation = git.Snapshot | Missing | Failed


def get(session: ReadSession, clone_id: uuid.UUID) -> CloneState | None:
    """The Clone's State, or None if it has none."""
    row = session.conn.execute(
        f"SELECT {', '.join(COLUMNS)} FROM state_clones WHERE clone_id = ?",  # noqa: S608 - our own constant
        (clone_id,),
    ).fetchone()
    return None if row is None else CloneState.from_row(row)


def _write(session: WriteSession, state: CloneState) -> None:
    """Stores a Clone's State, replacing the previous one."""
    values = {column: getattr(state, column) for column in COLUMNS} | {
        "root_commits": json.dumps(list(state.root_commits)),
        "remotes": json.dumps(state.remotes, sort_keys=True),
        "branches": json.dumps(list(state.branches)),
    }
    session.conn.execute(
        f"INSERT OR REPLACE INTO state_clones ({', '.join(COLUMNS)})"  # noqa: S608 - our own constant
        f" VALUES ({', '.join('?' * len(COLUMNS))})",
        tuple(values.values()),
    )


def _state_from(session: WriteSession, clone_id: uuid.UUID, snapshot: git.Snapshot) -> CloneState:
    """The State that a snapshot taken now gives."""
    return CloneState(
        clone_id=clone_id,
        observed_at=session.tick(),
        observed_by=session.machine_id,
        present=True,
        error=None,
        bare=snapshot.bare,
        head=snapshot.head,
        branch=snapshot.branch,
        **status_values(snapshot.status),
        root_commits=snapshot.root_commits,
        remotes=dict(snapshot.remotes),
        branches=snapshot.branches,
    )


def add(session: WriteSession, clone_id: uuid.UUID, snapshot: git.Snapshot) -> CloneState:
    """Stores a new Clone's first State; its `clone.added` Event says the rest."""
    state = _state_from(session, clone_id, snapshot)
    _write(session, state)
    return state


@dataclass(frozen=True)
class BranchPayload:
    """The payload of `clone.branch_created` and `clone.branch_deleted`."""

    branch: str


def caused_events(old: CloneState, new: CloneState) -> list[tuple[EventKind, object]]:
    """The Events that going from `old` to `new` causes, with their payloads."""
    caused: list[tuple[EventKind, object]] = [
        (
            EventKind(f"clone.{condition}"),
            Failed(new.error or "") if condition is Condition.FAILED else {},
        )
        for condition in conditions(old, new)
    ]
    caused += [
        (EventKind.CLONE_BRANCH_CREATED, BranchPayload(branch))
        for branch in sorted(set(new.branches) - set(old.branches))
    ]
    caused += [
        (EventKind.CLONE_BRANCH_DELETED, BranchPayload(branch))
        for branch in sorted(set(old.branches) - set(new.branches))
    ]
    remotes = {
        name: Change(old.remotes.get(name), new.remotes.get(name))
        for name in sorted(old.remotes.keys() | new.remotes.keys())
        if old.remotes.get(name) != new.remotes.get(name)
    }
    if remotes:
        caused.append((EventKind.CLONE_REMOTES_CHANGED, remotes))
    return caused


def update(session: WriteSession, clone_id: uuid.UUID, observation: Observation) -> list[Event]:
    """Stores what observing a Clone gave and records the Events it causes.

    When missing or failed, the rest of the State stays as last known. A repository without
    shared history at the Clone's path counts as failed, rather than replacing the Clone.
    """
    old = get(session, clone_id)
    if old is None:
        raise LookupError(f"Clone {clone_id} has no State")
    at, by = session.tick(), session.machine_id
    match observation:
        case Missing():
            new = dataclasses.replace(
                old, observed_at=at, observed_by=by, present=False, error=None
            )
        case Failed(error):
            new = dataclasses.replace(
                old, observed_at=at, observed_by=by, present=True, error=error
            )
        case git.Snapshot() if not git.shares_history(observation.root_commits, old.root_commits):
            error = "the repository here shares no history with this Clone"
            new = dataclasses.replace(
                old, observed_at=at, observed_by=by, present=True, error=error
            )
        case git.Snapshot():
            new = _state_from(session, clone_id, observation)
    _write(session, new)
    return [
        events.record(session, kind, clone_id, payload) for kind, payload in caused_events(old, new)
    ]
