"""The State of Terminals: what the Keeper of each Machine last showed of its Terminals.

A Terminal is open while its session runs, lost once it cannot run any more, after a reboot or
when the server of its Keeper died; lost ones keep their row and name until restored or killed.
One that ended, e.g. its shell exited, loses its row. Terminals record no Events.
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
from hephaistos.core.utils.text import escaped, number_text, utf8

log = logging.getLogger(__name__)

#: What hephaistos names Terminals; adopted ones keep their name in the Keeper, whatever it
#: is. tmux forbids `.` and `:`, and a leading `-` would read as an option.
NAMES = Names(
    kind="terminal",
    characters="A-Za-z0-9_-",
    described="ASCII letters, digits, '-' and '_'",
    max_length=64,
    first="A-Za-z0-9_",
    first_described="a letter, digit or '_'",
)
_NUMBERS = re.compile(r"([0-9]+)")
DEFAULT_BASE = "terminal"  # the start of a default name where the directory gives none

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
    # Splitting by a group puts its matches at the odd places.
    parts = enumerate(_NUMBERS.split(name))
    return tuple((0, int(part)) if index % 2 else (1, part) for index, part in parts)


def on_this_machine(session: ReadSession) -> list[TerminalState]:
    """The Terminals of this Machine, by name."""
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
    """The Terminal of this Machine named exactly `name`; raises NoSuchTerminalError."""
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
    """The Terminal of this Machine with that ID; None if it has none."""
    found = [state for state in on_this_machine(session) if state.id == terminal_id]
    return found[0] if found else None


def default_name(session: ReadSession, directory: Path, refused: Collection[str] = ()) -> str:
    """A name for a new Terminal in `directory`, e.g. `hephaistos-1`, then `hephaistos-2`.

    Derived from the name of the directory, numbered from 1 among the Terminals of this Machine,
    lost ones included, and past those in `refused`, e.g. taken by a session not observed yet.
    """
    base = NAMES.derived(directory.name) or DEFAULT_BASE
    return _free_name(base, {state.name for state in on_this_machine(session)} | set(refused))


def _write(session: WriteSession, state: TerminalState) -> None:
    """Stores the State of a Terminal, replacing its previous one.

    Its names and paths as UTF-8 holds them: a session started by hand where they are not, or a
    `cd` there, must not stop observation. A name another Terminal holds raises IntegrityError,
    never replaces that one.
    """
    stored = {
        "id": state.id,
        "name": utf8(state.name),
        "directory": utf8(str(state.directory)),
        "command": None if state.command is None else json.dumps(list(state.command)),
        "status": state.status.value,
        "boot_id": state.boot_id,
        "started_at": _ms(state.started_at),
        "active_at": _ms(state.active_at),
        "current_directory": None
        if state.current_directory is None
        else utf8(str(state.current_directory)),
        "program": utf8(state.program),
        "clients": state.clients,
        "panes": state.panes,
        "observed_at": state.observed_at,
        "observed_by": state.observed_by,
    }
    session.conn.execute(
        f"INSERT INTO state_terminals ({', '.join(COLUMNS)})"  # noqa: S608 - our own constant
        f" VALUES ({', '.join('?' * len(COLUMNS))})"
        f" ON CONFLICT (id) DO UPDATE SET {_UPDATED}",
        tuple(stored.values()),
    )


_UPDATED = ", ".join(f"{column} = excluded.{column}" for column in COLUMNS if column != "id")


def _delete(session: WriteSession, terminal_id: uuid.UUID) -> None:
    session.conn.execute("DELETE FROM state_terminals WHERE id = ?", (terminal_id,))


def rename_lost(session: WriteSession, state: TerminalState, new_name: str) -> None:
    """Renames a lost Terminal, which has no session to rename.

    Raises HephaistosError if another Terminal took `new_name` meanwhile.
    """
    try:
        _write(session, replace(state, name=new_name, observed_at=session.tick()))
    except sqlite3.IntegrityError:
        raise HephaistosError(
            f"a terminal named {escaped(new_name)} exists; choose another name"
        ) from None


def restored(session: WriteSession, state: TerminalState) -> None:
    """Records that a lost Terminal runs again, as a shell: its command, if any, ran no more.

    Only the command changes: an observation may have stored its session meanwhile.
    """
    session.conn.execute(
        "UPDATE state_terminals SET command = NULL, observed_at = ? WHERE id = ?",
        (session.tick(), state.id),
    )


def forget(session: WriteSession, state: TerminalState) -> None:
    """Deletes the row of a lost Terminal: it is killed without having run again."""
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
        log.warning(
            "the server of the keeper is gone: %s lost", number_text(unexpected, "terminal")
        )
    return ended, lost


def _names_taken(
    seen: Mapping[uuid.UUID, Session],
    known: Mapping[uuid.UUID, TerminalState],
    newer: Collection[uuid.UUID],
) -> dict[uuid.UUID, str]:
    """The name each found session gives its Terminal, as stored.

    Not for a session whose row, or the row holding its name, is a newer reading; nor for a
    second session whose name the database stores like that of another, e.g. two that differ
    only in bytes that are not UTF-8: their rows stay as they were.
    """
    holders = {state.name: terminal_id for terminal_id, state in known.items()}
    taking: dict[uuid.UUID, str] = {}
    for terminal_id, item in seen.items():
        name = utf8(item.name)
        if terminal_id in newer or holders.get(name) in newer or name in taking.values():
            continue
        taking[terminal_id] = name
    return taking


def _final_names(
    known: Mapping[uuid.UUID, TerminalState], taking: Mapping[uuid.UUID, str]
) -> dict[uuid.UUID, str]:
    """The name of each Terminal after an observation: that its session gives it, else its own.

    One whose name a session gives another, e.g. a lost one, or one renamed meanwhile, moves to
    a free name, e.g. `api-1`.
    """
    kept = {
        terminal_id: state.name for terminal_id, state in known.items() if terminal_id not in taking
    }
    given = set(taking.values())
    names = dict(taking) | {
        terminal_id: name for terminal_id, name in kept.items() if name not in given
    }
    taken = set(names.values())
    for terminal_id, name in sorted(kept.items(), key=lambda pair: name_order(pair[1])):
        if terminal_id not in names:
            names[terminal_id] = moved = _free_name(NAMES.derived(name) or DEFAULT_BASE, taken)
            taken.add(moved)
    return names


def update(  # noqa: PLR0913 - keyword-only after the first two: what one observation found
    session: WriteSession,
    found: Sequence[Session],
    *,
    running: bool,
    boot_id: str,
    started: Timestamp,
    command: Mapping[uuid.UUID, tuple[str, ...]] | None = None,
) -> Changes:
    """Stores what the Keeper showed of the Terminals of this Machine.

    `found` are its sessions with an ID (those without are left for the next observation),
    `running` whether its server runs. A Terminal not found ended if the server runs in the
    same boot; else it is lost. A found one takes its name from the Keeper; another holding
    that name moves to a free one. `command` holds what Terminals just created run, also for
    rows another process stored first; others found anew run a shell, or whatever was started
    by hand, which the Keeper does not say.

    `started` is the clock before the Keeper was asked. A row observed later, e.g. of a
    Terminal another process created meanwhile, is a newer reading than `found`, so it stays
    as it is, and so does a session whose name such a row holds: the next observation has both.
    """
    observed_at = session.tick()
    known = {state.id: state for state in on_this_machine(session)}
    for terminal_id, run in (command or {}).items():
        old = known.get(terminal_id)
        if old is not None and old.command is None:
            # Stored first by another process, which cannot know what it runs: its creator does.
            known[terminal_id] = replace(old, command=run, observed_at=observed_at)
            _write(session, known[terminal_id])
    newer = {state.id for state in known.values() if state.observed_at > started}
    seen = {item.terminal_id: item for item in found if item.terminal_id is not None}
    missing = [state for state in known.values() if state.id not in seen and state.id not in newer]
    # First, so that the names of ended Terminals become free.
    ended, lost = _end_or_lose(
        session, missing, running=running, boot_id=boot_id, observed_at=observed_at
    )
    remaining = {state.id: state for state in on_this_machine(session)}  # lost ones as lost now
    taking = _names_taken(seen, remaining, newer)
    names = _final_names(remaining, taking)
    # Rows whose name changes go first, so that each write finds its name free.
    renamed = [t for t, name in names.items() if t in remaining and name != remaining[t].name]
    for terminal_id in renamed:
        if terminal_id not in taking:
            log.info(
                "terminal %s gives its name to another, now %s",
                remaining[terminal_id].name,
                names[terminal_id],
            )
        _delete(session, terminal_id)
    for terminal_id, item in seen.items():
        if (name := taking.get(terminal_id)) is None:
            continue
        old = remaining.get(terminal_id)
        _write(
            session,
            TerminalState(
                id=terminal_id,
                name=name,
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
    for terminal_id in renamed:
        if terminal_id not in taking:
            _write(
                session,
                replace(remaining[terminal_id], name=names[terminal_id], observed_at=observed_at),
            )
    added = sum(terminal_id not in remaining for terminal_id in taking)
    return Changes(open=len(seen), added=added, ended=len(ended), lost=lost)
