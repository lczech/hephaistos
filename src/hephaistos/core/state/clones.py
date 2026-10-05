import json
import sqlite3
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Self

from hephaistos.core.db.sessions import WriteSession
from hephaistos.core.utils.git import Snapshot
from hephaistos.core.utils.ids import Timestamp


@dataclass(frozen=True, kw_only=True)
class CloneState:
    """What was last observed about a Clone."""

    clone_id: uuid.UUID
    observed_at: Timestamp
    observed_by: uuid.UUID
    present: bool
    bare: bool
    head: str | None
    branch: str | None
    root_commits: tuple[str, ...]
    remotes: Mapping[str, str]
    error: str | None

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> Self:
        """Builds a CloneState from a database row with its columns."""
        return cls(
            clone_id=uuid.UUID(bytes=row["clone_id"]),
            observed_at=Timestamp(row["observed_at"]),
            observed_by=uuid.UUID(bytes=row["observed_by"]),
            present=bool(row["present"]),
            bare=bool(row["bare"]),
            head=row["head"],
            branch=row["branch"],
            root_commits=tuple(json.loads(row["root_commits"])),
            remotes=json.loads(row["remotes"]),
            error=row["error"],
        )


COLUMNS = (
    "clone_id",
    "observed_at",
    "observed_by",
    "present",
    "bare",
    "head",
    "branch",
    "root_commits",
    "remotes",
    "error",
)


def save(session: WriteSession, clone_id: uuid.UUID, snapshot: Snapshot) -> CloneState:
    """Stores a Clone's State as observed now, replacing the previous one."""
    state = CloneState(
        clone_id=clone_id,
        observed_at=session.tick(),
        observed_by=session.machine_id,
        present=True,
        bare=snapshot.bare,
        head=snapshot.head,
        branch=snapshot.branch,
        root_commits=snapshot.root_commits,
        remotes=dict(snapshot.remotes),
        error=None,
    )
    session.conn.execute(
        f"INSERT OR REPLACE INTO state_clones ({', '.join(COLUMNS)})"  # noqa: S608
        f" VALUES ({', '.join('?' * len(COLUMNS))})",
        (
            state.clone_id,
            state.observed_at,
            state.observed_by,
            state.present,
            state.bare,
            state.head,
            state.branch,
            json.dumps(list(state.root_commits)),
            json.dumps(state.remotes, sort_keys=True),
            state.error,
        ),
    )
    return state
