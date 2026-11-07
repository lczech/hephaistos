"""Terminals' State: what each Machine's Keeper last showed of its Terminals.

A Terminal is open while its session runs, lost once it can't run any more, after a reboot or
when its Keeper's server died; lost ones keep their row and name until restored or killed. One
that ended, e.g. its shell exited, loses its row. Terminals record no Events.
"""

import json
import logging
import re
import sqlite3
import uuid
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path
from typing import Self

from hephaistos.core.db import values
from hephaistos.core.db.sessions import ReadSession, WriteSession
from hephaistos.core.terminals.keeper import Session
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.ids import Timestamp
from hephaistos.core.utils.names import Names
from hephaistos.core.utils.text import escaped, number_text

log = logging.getLogger(__name__)

#: What hephaistos names Terminals; adopted ones keep the Keeper's name, whatever it is. tmux
#: forbids `.` and `:`, and a leading `-` would read as an option.
NAMES = Names(
    kind="terminal",
    characters="A-Za-z0-9_-",
    described="ASCII letters, digits, '-' and '_'",
    max_length=64,
    first="A-Za-z0-9_",
    first_described="a letter, digit or '_'",
)
_NUMBERS = re.compile(r"(\d+)")
DEFAULT_BASE = "terminal"  # a default name's start where the directory gives none

#: The columns of `state_terminals`, decoded for raw listings.
DECODERS = {
    "id": values.uuid_bytes,
    "name": values.plain,
    "directory": values.plain,
    "command": values.json_text,
    "status": values.plain,
    "boot_id": values.plain,
    "started_at": values.milliseconds,
    "active_at": values.milliseconds,
    "current_directory": values.plain,
    "program": values.plain,
    "clients": values.plain,
    "panes": values.plain,
    "observed_at": values.clock,
    "observed_by": values.uuid_bytes,
}
COLUMNS = tuple(DECODERS)


class TerminalStatus(StrEnum):
    """Whether a Terminal runs."""

    OPEN = "open"
    LOST = "lost"  # its session is gone, but it was never ended: restorable


@dataclass(frozen=True, kw_only=True)
class TerminalState:
    """What was last observed about a Terminal."""

    id: uuid.UUID
    name: str
    directory: Path  # where it started
    command: tuple[str, ...] | None  # None for a shell
    status: TerminalStatus
    boot_id: str  # of the boot it last ran in
    started_at: datetime
    active_at: datetime
    current_directory: Path | None
    program: str
    clients: int
    panes: int
    observed_at: Timestamp
    observed_by: uuid.UUID

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> Self:
        """Builds a TerminalState from a database row with its columns."""
        command = row["command"]
        return cls(
            id=uuid.UUID(bytes=row["id"]),
            name=row["name"],
            directory=Path(row["directory"]),
            command=None if command is None else tuple(json.loads(command)),
            status=TerminalStatus(row["status"]),
            boot_id=row["boot_id"],
            started_at=_datetime(row["started_at"]),
            active_at=_datetime(row["active_at"]),
            current_directory=(
                None if row["current_directory"] is None else Path(row["current_directory"])
            ),
            program=row["program"],
            clients=row["clients"],
            panes=row["panes"],
            observed_at=Timestamp(row["observed_at"]),
            observed_by=uuid.UUID(bytes=row["observed_by"]),
        )


def _datetime(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000, UTC)


def _ms(moment: datetime) -> int:
    return round(moment.timestamp() * 1000)


def name_order(name: str) -> tuple[tuple[int, int | str], ...]:
    """What names sort by: numbers as numbers, so `proj-2` comes before `proj-10`."""
    return tuple((0, int(part)) if part.isdigit() else (1, part) for part in _NUMBERS.split(name))


def on_this_machine(session: ReadSession) -> list[TerminalState]:
    """This Machine's Terminals, by name."""
    rows = session.conn.execute(
        f"SELECT {', '.join(COLUMNS)} FROM state_terminals WHERE observed_by = ?",  # noqa: S608 - our own constant
        (session.machine_id,),
    )
    return sorted((TerminalState.from_row(row) for row in rows), key=lambda s: name_order(s.name))


class NoSuchTerminalError(HephaistosError):
    """No Terminal on this Machine has that name."""

    def __init__(self, name: str) -> None:
        """Creates the error, naming the Terminal."""
        super().__init__(f"no terminal named {escaped(name)} on this machine")


def by_name(session: ReadSession, name: str) -> TerminalState:
    """This Machine's Terminal named exactly `name`; raises NoSuchTerminalError."""
    for state in on_this_machine(session):
        if state.name == name:
            return state
    raise NoSuchTerminalError(name)


def _free_name(base: str, taken: Collection[str]) -> str:
    """`base-1`, or the first number after it that no name in `taken` has."""
    number = 1
    while True:
        suffix = f"-{number}"
        name = base[: NAMES.max_length - len(suffix)] + suffix
        if name not in taken:
            return name
        number += 1


def by_id(session: ReadSession, terminal_id: uuid.UUID) -> TerminalState | None:
    """This Machine's Terminal with that ID; None if it has none."""
    found = [state for state in on_this_machine(session) if state.id == terminal_id]
    return found[0] if found else None


def default_name(session: ReadSession, directory: Path, refused: Collection[str] = ()) -> str:
    """A name for a new Terminal in `directory`, e.g. `hephaistos-1`, then `hephaistos-2`.

    Derived from the directory's name, numbered from 1 among this Machine's Terminals, lost ones
    included, and past those in `refused`, e.g. taken by a session not observed yet.
    """
    base = NAMES.derived(directory.name) or DEFAULT_BASE
    return _free_name(base, {state.name for state in on_this_machine(session)} | set(refused))


def _write(session: WriteSession, state: TerminalState) -> None:
    """Stores a Terminal's State, replacing the previous one."""
    stored = {
        "id": state.id,
        "name": state.name,
        "directory": state.directory,
        "command": None if state.command is None else json.dumps(list(state.command)),
        "status": state.status.value,
        "boot_id": state.boot_id,
        "started_at": _ms(state.started_at),
        "active_at": _ms(state.active_at),
        "current_directory": state.current_directory,
        "program": state.program,
        "clients": state.clients,
        "panes": state.panes,
        "observed_at": state.observed_at,
        "observed_by": state.observed_by,
    }
    session.conn.execute(
        f"INSERT OR REPLACE INTO state_terminals ({', '.join(COLUMNS)})"  # noqa: S608 - our own constant
        f" VALUES ({', '.join('?' * len(COLUMNS))})",
        tuple(stored.values()),
    )


def _delete(session: WriteSession, terminal_id: uuid.UUID) -> None:
    session.conn.execute("DELETE FROM state_terminals WHERE id = ?", (terminal_id,))


def rename_lost(session: WriteSession, state: TerminalState, new_name: str) -> None:
    """Renames a lost Terminal, which has no session to rename."""
    _write(session, replace(state, name=new_name, observed_at=session.tick()))


def forget(session: WriteSession, state: TerminalState) -> None:
    """Deletes a lost Terminal's row: it is killed without having run again."""
    _delete(session, state.id)


@dataclass(frozen=True)
class Changes:
    """What one observation changed."""

    open: int  # Terminals seen running
    added: int  # rows new, e.g. adopted
    ended: int  # rows deleted
    lost: int  # rows newly lost


def _end_or_lose(
    session: WriteSession,
    missing: Sequence[TerminalState],
    *,
    running: bool,
    boot_id: str,
    observed_at: Timestamp,
) -> tuple[set[uuid.UUID], int]:
    """Deletes the open Terminals not found that ended, and marks the others lost.

    Returns those ended and how many were lost. Lost ones not found stay so.
    """
    ended: set[uuid.UUID] = set()
    lost = rebooted = 0
    for state in missing:
        if state.status is not TerminalStatus.OPEN:
            continue
        if running and state.boot_id == boot_id:
            _delete(session, state.id)
            ended.add(state.id)
            continue
        _write(session, replace(state, status=TerminalStatus.LOST, observed_at=observed_at))
        lost += 1
        rebooted += state.boot_id != boot_id
    if rebooted:
        log.info("%s lost by a reboot", number_text(rebooted, "terminal"))
    if unexpected := lost - rebooted:  # in the same boot
        log.warning("the Keeper's server is gone: %s lost", number_text(unexpected, "terminal"))
    return ended, lost


def update(  # noqa: PLR0913 - keyword-only after the first two: what one observation found
    session: WriteSession,
    found: Sequence[Session],
    *,
    running: bool,
    boot_id: str,
    started: Timestamp,
    command: Mapping[uuid.UUID, tuple[str, ...]] | None = None,
) -> Changes:
    """Stores what the Keeper showed of this Machine's Terminals.

    `found` are its sessions with an ID (those without are left for the next observation),
    `running` whether its server runs. A Terminal not found ended if the server runs in the
    same boot; else it is lost. A found one takes its name from the Keeper; another holding
    that name moves to a free one. `command` holds what Terminals just created run, also for
    rows another process stored first; others found anew run a shell, or whatever was started
    by hand, which the Keeper doesn't say.

    `started` is the clock before the Keeper was asked. A row observed later, e.g. of a
    Terminal another process created meanwhile, is a newer reading than `found`, so it stays
    as it is, and so does a session whose name such a row holds: the next observation has both.
    """
    observed_at = session.tick()
    known = {state.id: state for state in on_this_machine(session)}
    for terminal_id, run in (command or {}).items():
        old = known.get(terminal_id)
        if old is not None and old.command is None:
            # Stored first by another process, which can't know what it runs: its creator does.
            known[terminal_id] = replace(old, command=run, observed_at=observed_at)
            _write(session, known[terminal_id])
    newer = {state.id for state in known.values() if state.observed_at > started}
    seen = {item.terminal_id: item for item in found if item.terminal_id is not None}
    missing = [state for state in known.values() if state.id not in seen and state.id not in newer]
    # First, so that the names of ended Terminals become free.
    ended, lost = _end_or_lose(
        session, missing, running=running, boot_id=boot_id, observed_at=observed_at
    )
    names = {state.name: state.id for state in known.values() if state.id not in ended}
    added = 0

    for terminal_id, item in seen.items():
        holder = names.get(item.name)
        if terminal_id in newer or holder in newer:
            continue
        if holder is not None and holder != terminal_id:  # a lost one, or one renamed meanwhile
            other = known[holder]
            moved = _free_name(NAMES.derived(other.name) or DEFAULT_BASE, names)
            log.info("terminal %s takes its name from another, now %s", item.name, moved)
            _write(session, replace(other, name=moved, observed_at=observed_at))
            del names[other.name]
            names[moved] = holder
        old = known.get(terminal_id)
        if old is not None and names.get(old.name) == terminal_id and old.name != item.name:
            del names[old.name]
        names[item.name] = terminal_id
        if old is None:
            added += 1
        _write(
            session,
            TerminalState(
                id=terminal_id,
                name=item.name,
                directory=old.directory if old else item.directory,
                command=old.command if old else (command or {}).get(terminal_id),
                status=TerminalStatus.OPEN,
                boot_id=boot_id,
                started_at=item.created_at,
                active_at=item.active_at,
                current_directory=item.current_directory,
                program=item.program,
                clients=item.clients,
                panes=item.panes,
                observed_at=observed_at,
                observed_by=session.machine_id,
            ),
        )
    return Changes(open=len(seen), added=added, ended=len(ended), lost=lost)
