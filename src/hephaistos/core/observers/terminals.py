"""Observes the Terminals of this Machine: the Keeper first, then one write session."""

import logging
import uuid
from collections.abc import Mapping
from dataclasses import dataclass, replace
from pathlib import Path

from hephaistos.core.db.sessions import read_session, write_session
from hephaistos.core.state import terminals as state
from hephaistos.core.state.terminals import Changes, TerminalState
from hephaistos.core.terminals.keeper import Keeper, KeeperError, Session
from hephaistos.core.terminals.tmux import TmuxKeeper
from hephaistos.core.utils.ids import new_id
from hephaistos.core.utils.paths import Paths

log = logging.getLogger(__name__)

BOOT_ID = Path("/proc/sys/kernel/random/boot_id")  # by Linux: new at each boot
UNKNOWN_BOOT = "unknown"  # elsewhere: then only a dead server makes Terminals lost


@dataclass(frozen=True)
class Result:
    """What one observation did."""

    changes: Changes | None  # None if the Keeper could not be asked
    error: str | None = None  # why not, if this Machine has Terminals; else that is no news


def boot_id(path: Path = BOOT_ID) -> str:
    """The ID of this boot, or UNKNOWN_BOOT where there is none."""
    try:
        return path.read_text().strip() or UNKNOWN_BOOT
    except OSError:
        return UNKNOWN_BOOT


def _adopted(keeper: Keeper, found: list[Session], stored: list[TerminalState]) -> list[Session]:
    """`found`, each with an ID of its own; gone ones are left out.

    Adopts those without one, with an invalid one, or with one another session has (copied by
    hand, say). A session named like a Terminal whose session is gone, lost or ended, takes the ID
    of that one, e.g. one started by hand after a reboot.
    """
    names = {terminal.id: terminal.name for terminal in stored}
    lost = {t.name: t.id for t in stored if t.session_gone}

    def order(item: Session) -> tuple[bool, bool, object, str]:
        # Of sessions sharing an ID, the one named like its Terminal keeps it, else the oldest.
        return (
            item.terminal_id is None,
            names.get(item.terminal_id) != item.name if item.terminal_id else True,
            item.created_at,
            item.key,
        )

    claimed: set[uuid.UUID] = set()
    adopted: list[Session] = []
    for item in sorted(found, key=order):
        if item.terminal_id is not None and item.terminal_id not in claimed:
            claimed.add(item.terminal_id)
            adopted.append(item)
            continue
        wanted = lost.get(item.name)
        if wanted is None or wanted in claimed:
            wanted = new_id()
        given = keeper.adopt(item, wanted)
        if given is None or given in claimed:  # gone, or another process is midway: next time
            continue
        log.info("adopted terminal %s as %s", item.name, given)
        claimed.add(given)
        adopted.append(replace(item, terminal_id=given, id_text=str(given)))
    return adopted


def observe(
    paths: Paths,
    keeper: Keeper | None = None,
    *,
    boot_file: Path = BOOT_ID,
    command: Mapping[uuid.UUID, tuple[str, ...]] | None = None,
) -> Result:
    """Observes the Terminals of this Machine with `keeper`, else the one its settings describe.

    `command` holds what Terminals just created run, which the Keeper does not say.

    The Keeper runs outside any transaction. A Machine without a working Keeper, e.g. without
    tmux, and without Terminals is no news; with Terminals, it is logged and their rows stay as
    they were, their age showing that.
    """
    keeper = keeper or TmuxKeeper.from_settings(paths)
    with read_session(paths) as session:
        started = session.clock_value  # rows observed after it are newer than what we find
        stored = state.on_this_machine(session)
    try:
        listing = keeper.listing()
        running = bool(listing.sessions or listing.unreadable) or keeper.running()
        found = _adopted(keeper, listing.sessions, stored)
    except KeeperError as error:
        if not stored:
            log.debug("no terminals observed: %s", error)
            return Result(None)
        log.warning("terminals not observed: %s", error)
        return Result(None, str(error))
    with write_session(paths) as session:
        changes = state.update(
            session,
            found,
            running=running,
            boot_id=boot_id(boot_file),
            started=started,
            command=command,
            unreadable=listing.unreadable,
        )
    return Result(changes)
