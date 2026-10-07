"""A Clone's State: what was last observed about it, and the Events its changes cause."""

import dataclasses
import json
import sqlite3
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Self

from hephaistos.core.db import values
from hephaistos.core.db.sessions import ReadSession, WriteSession
from hephaistos.core.events import events
from hephaistos.core.events.events import Caused, Change, Event
from hephaistos.core.events.kinds import EventKind
from hephaistos.core.state import activity, checkouts
from hephaistos.core.state.activity import BEGINNING, BranchOrigin, CloneActivity, Cursor
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

#: The columns of `state_clones`, decoded for raw views.
DECODERS = checkouts.DECODERS | {
    "clone_id": values.uuid_bytes,
    "bare": values.plain,
    "root_commits": values.json_text,
    "remotes": values.json_text,
    "branches": values.json_text,
    "push_log": values.json_text,
}


@dataclass(frozen=True, kw_only=True)
class CloneState(CheckoutState):
    """What was last observed about a Clone."""

    clone_id: uuid.UUID
    bare: bool
    root_commits: tuple[str, ...]
    remotes: Mapping[str, str]
    branches: tuple[str, ...]
    # Where reading the remote-tracking reflogs stopped, by ref; None before the first read.
    push_log: Mapping[str, Cursor] | None

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
            head_log=None if row["head_log"] is None else Cursor.from_text(row["head_log"]),
            push_log=None
            if row["push_log"] is None
            else {ref: Cursor.from_text(text) for ref, text in json.loads(row["push_log"]).items()},
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
    "head_log",
    "push_log",
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
        "head_log": None if state.head_log is None else state.head_log.to_text(),
        "push_log": None
        if state.push_log is None
        else json.dumps({ref: cursor.to_text() for ref, cursor in state.push_log.items()}),
    }
    session.conn.execute(
        f"INSERT OR REPLACE INTO state_clones ({', '.join(COLUMNS)})"  # noqa: S608 - our own constant
        f" VALUES ({', '.join('?' * len(COLUMNS))})",
        tuple(values.values()),
    )


def _state_from(
    session: WriteSession,
    clone_id: uuid.UUID,
    snapshot: git.Snapshot,
    head_log: Cursor | None,
    push_log: Mapping[str, Cursor] | None,
) -> CloneState:
    """The State that a snapshot taken now gives, with where reading the reflogs stopped."""
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
        head_log=head_log,
        push_log=push_log,
    )


def add(
    session: WriteSession,
    clone_id: uuid.UUID,
    snapshot: git.Snapshot,
    *,
    import_history: bool = False,
) -> CloneState:
    """Stores a new Clone's first State; its `clone.added` Event says the rest.

    Its git activity counts from the first observation on, or with `import_history` from
    what its reflogs still hold.
    """
    state = (
        _state_from(session, clone_id, snapshot, BEGINNING, {})
        if import_history
        else _state_from(session, clone_id, snapshot, None, None)
    )
    _write(session, state)
    return state


@dataclass(frozen=True)
class BranchPayload:
    """The payload of `clone.branch_deleted`."""

    branch: str


@dataclass(frozen=True)
class CreatedPayload(BranchPayload):
    """The payload of `clone.branch_created`; where from, if its reflog says."""

    start: str | None


@dataclass(frozen=True)
class RenamedPayload:
    """The payload of `clone.branch_renamed`."""

    branch: Change


def _branch_events(
    old: CloneState, new: CloneState, origins: Mapping[str, BranchOrigin]
) -> list[Caused]:
    """The branches created, renamed and deleted; a branch's reflog gives its time and key."""
    created = sorted(set(new.branches) - set(old.branches))
    deleted = sorted(set(old.branches) - set(new.branches))
    renamed = {
        branch: origin.renamed_from
        for branch in created
        if (origin := origins.get(branch)) and origin.renamed_from in deleted
    }
    caused: list[Caused] = []
    for branch in created:
        origin = origins.get(branch, activity.UNKNOWN_ORIGIN)
        ref = f"refs/heads/{branch}"
        if branch in renamed:
            names = Change(renamed[branch], branch)
            at = origin.renamed_at
            key = None if at is None else activity.key(new.clone_id, "", ref, at, names)
            caused.append(Caused(EventKind.CLONE_BRANCH_RENAMED, RenamedPayload(names), at, key))
        else:
            at = origin.created_at
            start = Change(None, origin.start)
            key = None if at is None else activity.key(new.clone_id, "", ref, at, start)
            payload = CreatedPayload(branch, origin.start)
            caused.append(Caused(EventKind.CLONE_BRANCH_CREATED, payload, at, key))
    caused += [
        Caused(EventKind.CLONE_BRANCH_DELETED, BranchPayload(branch))
        for branch in deleted
        if branch not in renamed.values()
    ]
    return caused


def caused_events(
    old: CloneState, new: CloneState, origins: Mapping[str, BranchOrigin] | None = None
) -> list[Caused]:
    """The Events that going from `old` to `new` causes.

    `origins` tells where new branches came from, and which were renamed rather than created.
    """
    caused = [
        Caused(
            EventKind(f"clone.{condition}"),
            Failed(new.error or "") if condition is Condition.FAILED else {},
        )
        for condition in conditions(old, new)
    ]
    caused += _branch_events(old, new, origins or {})
    remotes = {
        name: Change(old.remotes.get(name), new.remotes.get(name))
        for name in sorted(old.remotes.keys() | new.remotes.keys())
        if old.remotes.get(name) != new.remotes.get(name)
    }
    if remotes:
        caused.append(Caused(EventKind.CLONE_REMOTES_CHANGED, remotes))
    return caused


def _activity_events(clone_id: uuid.UUID, read: CloneActivity) -> list[Caused]:
    """The Events of a Clone's git activity and pushes, in the order they happened."""
    found = [
        (
            done.occurred_at,
            Caused(
                EventKind(f"clone.{done.kind}"),
                done.payload,
                done.occurred_at,
                activity.key(clone_id, "", "HEAD", done.occurred_at, done.payload.head),
            ),
        )
        for done in read.activities
    ]
    found += [
        (
            push.occurred_at,
            Caused(
                EventKind.CLONE_PUSHED,
                push.payload,
                push.occurred_at,
                activity.key(
                    clone_id,
                    "",
                    f"refs/remotes/{push.payload.branch}",
                    push.occurred_at,
                    push.payload.commit,
                ),
            ),
        )
        for push in read.pushes
    ]
    # Sorting is stable: what happened in the same second keeps its reflog order.
    return [caused for _, caused in sorted(found, key=lambda item: item[0])]


def update(
    session: WriteSession,
    clone_id: uuid.UUID,
    observation: Observation,
    read: CloneActivity | None = None,
) -> list[Event]:
    """Stores what observing a Clone gave and records the Events it causes.

    When missing or failed, the rest of the State stays as last known. A repository without
    shared history at the Clone's path counts as failed, rather than replacing the Clone.
    `read` is what reading its reflogs gave, if they were read.
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
            new = (
                _state_from(session, clone_id, observation, old.head_log, old.push_log)
                if read is None
                else _state_from(session, clone_id, observation, read.cursor, read.push_cursors)
            )
    _write(session, new)
    caused = caused_events(old, new, None if read is None else read.origins)
    if read is not None and new.present and new.error is None:
        caused += _activity_events(clone_id, read)
    return [
        events.record(
            session,
            event.kind,
            clone_id,
            event.payload,
            occurred_at=event.occurred_at,
            key=event.key,
        )
        for event in caused
    ]
