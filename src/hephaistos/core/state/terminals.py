"""The State of Terminals: what the Keeper of each Machine last showed of its Terminals.

A Terminal is open while its program runs. It ended once the program of a command ended, or a
signal ended any: its session stays, showing its last screen, and its row keeps how and when,
until killed. It is lost once it cannot run any more, after a reboot or when the server of its
Keeper died; lost ones keep their row and name until restored or killed, and so do ended ones
whose session went that way, with their screen gone. One whose session closed, e.g. a shell that
exited, or one killed by hand, loses its row. Terminals record no Events.
"""

import json
import logging
import re
import signal
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
    "attached": values.plain,
    "panes": values.plain,
    "exit_status": values.plain,
    "exit_signal": values.plain,
    "ended_at": values.milliseconds,
    "noticed_at": values.milliseconds,
    "lost_because": values.plain,
    "observed_at": values.clock,
    "observed_by": values.uuid_bytes,
}
COLUMNS = tuple(DECODERS)


class TerminalStatus(StrEnum):
    """Whether a Terminal runs."""

    OPEN = "open"
    ENDED = "ended"  # its program ended; kept, showing how, until killed
    LOST = "lost"  # its session is gone, but it was never ended: restorable


class LostBecause(StrEnum):
    """Why the session of a Terminal is gone, though it was never closed."""

    REBOOT = "reboot"  # the Machine started again
    SERVER = "server"  # the server of its Keeper ended, e.g. crashed or killed, in the same boot


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
    attached: int
    panes: int
    observed_at: Timestamp
    observed_by: uuid.UUID
    # How its program ended, while ended: an exit status, or the signal, if the Keeper says which.
    exit_status: int | None = None
    exit_signal: int | None = None
    ended_at: datetime | None = None  # when, or when first seen ended, if the Keeper does not say
    # When its session was found gone, and why: while lost, or ended with its last screen gone.
    noticed_at: datetime | None = None
    lost_because: LostBecause | None = None

    @property
    def session_gone(self) -> bool:
        """Whether the Keeper holds nothing of it: lost, or ended with its session gone since."""
        return self.noticed_at is not None

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
            attached=row["attached"],
            panes=row["panes"],
            observed_at=Timestamp(row["observed_at"]),
            observed_by=uuid.UUID(bytes=row["observed_by"]),
            exit_status=row["exit_status"],
            exit_signal=row["exit_signal"],
            ended_at=_optional_datetime(row["ended_at"]),
            noticed_at=_optional_datetime(row["noticed_at"]),
            lost_because=None if row["lost_because"] is None else LostBecause(row["lost_because"]),
        )


def _datetime(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000, UTC)


def _signal_name(number: int) -> str | None:
    """The name of a signal, e.g. `SIGTERM`; None for a number that names none."""
    try:
        return signal.Signals(number).name
    except ValueError:
        return None


def ending_text(state: TerminalState) -> str:
    """How the program of an ended Terminal ended, in the words of the line tmux shows in it.

    `finished` (status 0), `exited with status 1`, `ended by signal 15 (SIGTERM)`; `ended by a
    signal` where the Keeper does not say which, as tmux before 3.3.
    """
    if state.exit_status == 0:
        return "finished"
    if state.exit_status is not None:
        return f"exited with status {state.exit_status}"
    if state.exit_signal is None:
        return "ended by a signal"
    name = _signal_name(state.exit_signal)
    return f"ended by signal {state.exit_signal}" + ("" if name is None else f" ({name})")


def ending_brief(state: TerminalState) -> str:
    """As `ending_text`, short, as after `ended`: `finished`, `status 1`, `signal 15, SIGTERM`."""
    if state.exit_status == 0:
        return "finished"
    if state.exit_status is not None:
        return f"status {state.exit_status}"
    if state.exit_signal is None:
        return "signal"
    name = _signal_name(state.exit_signal)
    return f"signal {state.exit_signal}" + ("" if name is None else f", {name}")


#: Why the session of a Terminal is gone, as said after "as": `as the machine restarted`.
LOST_TEXTS = {
    LostBecause.REBOOT: "the machine restarted",
    LostBecause.SERVER: "the tmux server ended",
}


def _optional_datetime(ms: int | None) -> datetime | None:
    return None if ms is None else _datetime(ms)


def _ms(moment: datetime) -> int:
    return round(moment.timestamp() * 1000)


def _optional_ms(moment: datetime | None) -> int | None:
    return None if moment is None else _ms(moment)


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
        "attached": state.attached,
        "panes": state.panes,
        "exit_status": state.exit_status,
        "exit_signal": state.exit_signal,
        "ended_at": _optional_ms(state.ended_at),
        "noticed_at": _optional_ms(state.noticed_at),
        "lost_because": None if state.lost_because is None else state.lost_because.value,
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
    """Renames a Terminal whose session is gone, e.g. a lost one, as it has none to rename.

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
    """Deletes the row of a Terminal whose session is gone: it is killed without one."""
    _delete(session, state.id)


@dataclass(frozen=True)
class Changes:
    """What one observation changed."""

    open: int  # Terminals seen running
    added: int  # rows new, e.g. adopted
    ended: int  # rows newly ended
    closed: int  # rows deleted
    lost: int  # rows whose session is newly gone: lost, or ended with their screen gone


def _close_or_lose(
    session: WriteSession,
    missing: Sequence[TerminalState],
    *,
    running: bool,
    boot_id: str,
    observed_at: Timestamp,
) -> tuple[set[uuid.UUID], int]:
    """Deletes the Terminals not found whose session closed, and marks the others' gone.

    A session closed if the server runs in the same boot: e.g. a shell exited, or someone killed
    it. Otherwise it went with the server: an open Terminal is lost, an ended one stays so, with
    its screen gone; both say when and why. Returns those closed and how many went so. Those whose
    session was gone already stay as they are.
    """
    closed: set[uuid.UUID] = set()
    lost = rebooted = 0
    for state in missing:
        if state.session_gone:
            continue
        if running and state.boot_id == boot_id:
            _delete(session, state.id)
            closed.add(state.id)
            continue
        because = LostBecause.REBOOT if state.boot_id != boot_id else LostBecause.SERVER
        gone = replace(
            state,
            status=TerminalStatus.LOST if state.status is TerminalStatus.OPEN else state.status,
            attached=0,
            noticed_at=observed_at.datetime,
            lost_because=because,
            observed_at=observed_at,
        )
        _write(session, gone)
        lost += 1
        rebooted += because is LostBecause.REBOOT
    if rebooted:
        log.info("%s lost by a reboot", number_text(rebooted, "terminal"))
    if unexpected := lost - rebooted:  # in the same boot
        log.warning(
            "the server of the keeper is gone: %s lost", number_text(unexpected, "terminal")
        )
    return closed, lost


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
    unreadable: Collection[uuid.UUID] = (),
) -> Changes:
    """Stores what the Keeper showed of the Terminals of this Machine.

    `found` are its sessions with an ID (those without are left for the next observation),
    `running` whether its server runs. A Terminal not found ended if the server runs in the
    same boot; else it is lost. A found one takes its name from the Keeper; another holding
    that name moves to a free one. `command` holds what Terminals just created run, also for
    rows another process stored first; others found anew run a shell, or whatever was started
    by hand, which the Keeper does not say. `unreadable` are the IDs of sessions it lists but
    could not read, e.g. renamed by hand to no name: their rows stay as they were.

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
    missing = [
        state
        for state in known.values()
        if state.id not in seen and state.id not in newer and state.id not in unreadable
    ]
    # First, so that the names of closed Terminals become free.
    closed, lost = _close_or_lose(
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
    ended = 0
    for terminal_id, item in seen.items():
        if (name := taking.get(terminal_id)) is None:
            continue
        old = remaining.get(terminal_id)
        found_state = _found(
            item,
            old,
            terminal_id=terminal_id,
            name=name,
            command=(command or {}).get(terminal_id),
            boot_id=boot_id,
            observed_at=observed_at,
            observed_by=session.machine_id,
        )
        ended += found_state.status is TerminalStatus.ENDED and (
            old is None or old.status is not TerminalStatus.ENDED
        )
        _write(session, found_state)
    for terminal_id in renamed:
        if terminal_id not in taking:
            _write(
                session,
                replace(remaining[terminal_id], name=names[terminal_id], observed_at=observed_at),
            )
    added = sum(terminal_id not in remaining for terminal_id in taking)
    running_now = sum(item.ending is None for item in seen.values())
    return Changes(open=running_now, added=added, ended=ended, closed=len(closed), lost=lost)


def _found(  # noqa: PLR0913 - keyword-only after the first two: what one observation found
    item: Session,
    old: TerminalState | None,
    *,
    terminal_id: uuid.UUID,
    name: str,
    command: tuple[str, ...] | None,
    boot_id: str,
    observed_at: Timestamp,
    observed_by: uuid.UUID,
) -> TerminalState:
    """The State of a Terminal whose session was found: open, or ended, as its program is.

    An ended one keeps when it was first seen so, where the Keeper does not say when it ended,
    and the program and directory last seen while it ran, as the Keeper knows neither once it
    ended. One never seen running with a program known has the name of its command's program.
    """
    ending = item.ending
    run = old.command if old else command
    ended_at = None
    program, current = item.program, item.current_directory
    if ending is not None:
        before = old.ended_at if old is not None and old.status is TerminalStatus.ENDED else None
        ended_at = ending.at or before or observed_at.datetime
        if old is not None and not old.session_gone:
            program, current = old.program, old.current_directory
        if not program and run:
            program = Path(run[0]).name
    return TerminalState(
        id=terminal_id,
        name=name,
        directory=old.directory if old else item.directory,
        command=run,
        status=TerminalStatus.OPEN if ending is None else TerminalStatus.ENDED,
        boot_id=boot_id,
        started_at=item.created_at,
        active_at=item.active_at,
        current_directory=current,
        program=program,
        attached=item.attached,
        panes=item.panes,
        observed_at=observed_at,
        observed_by=observed_by,
        exit_status=None if ending is None else ending.status,
        exit_signal=None if ending is None else ending.signal,
        ended_at=ended_at,
    )
