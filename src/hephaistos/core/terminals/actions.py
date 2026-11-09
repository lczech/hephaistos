"""What users do to Terminals: create, attach, rename and kill them, for the CLI and the Server.

Each observes first, so that it acts on what the Keeper holds now, then acts on the Keeper
outside any transaction, then observes again: State always comes from the one comparison
(`observers/terminals.py`). A lost Terminal has no session, so its row alone changes.
"""

import contextlib
import os
import shlex
import uuid
from collections.abc import Mapping, Sequence
from pathlib import Path

from hephaistos.core.db.sessions import read_session, write_session
from hephaistos.core.observers import terminals as observer
from hephaistos.core.state import terminals as state
from hephaistos.core.state.terminals import NAMES, TerminalState, TerminalStatus
from hephaistos.core.terminals.keeper import (
    TERMINAL_VARIABLE,
    Keeper,
    NameTakenError,
    NoSuchSessionError,
)
from hephaistos.core.terminals.tmux import TmuxKeeper, login_shell
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.ids import new_id
from hephaistos.core.utils.paths import Paths, absolute, short_path
from hephaistos.core.utils.text import escaped, is_utf8

MAX_TRIES = 100  # default names tried while others take them meanwhile


def _taken_text(name: str, lost: bool) -> str:  # noqa: FBT001 - a flag, as the row has it
    if lost:
        return f"a lost terminal named {escaped(name)} exists; kill it, or choose another name"
    return f"a terminal named {escaped(name)} exists; choose another name"


def _observed(
    paths: Paths, keeper: Keeper, command: Mapping[uuid.UUID, tuple[str, ...]] | None = None
) -> None:
    """Observes; raises HephaistosError if the Keeper cannot be asked."""
    result = observer.observe(paths, keeper, command=command)
    if result.error is not None:
        raise HephaistosError(f"terminals cannot be observed: {result.error}")


def _directory(directory: Path) -> Path:
    """`directory` absolute, symlinks resolved; raises HephaistosError unless one we can enter."""
    resolved = absolute(directory).resolve()
    if not resolved.exists():
        raise HephaistosError(f"no directory {short_path(resolved)}")
    if not resolved.is_dir():
        raise HephaistosError(f"{short_path(resolved)} is not a directory")
    if not os.access(resolved, os.X_OK):
        raise HephaistosError(f"cannot enter {short_path(resolved)}")
    if not is_utf8(str(resolved)):
        path = short_path(resolved)
        raise HephaistosError(f"{path} is not UTF-8, as terminals need; choose another directory")
    return resolved


def create(  # noqa: PLR0913 - all but the first two keyword-only
    paths: Paths,
    directory: Path,
    *,
    name: str | None = None,
    command: Sequence[str] | None = None,
    keeper: Keeper | None = None,
    environment: Mapping[str, str] = os.environ,
) -> TerminalState:
    """Starts a Terminal in `directory`: `command`, else the login shell of the creator.

    Named `name`, else by the directory, the next free number; another process taking that
    name meanwhile moves it on to the next. `environment` is that of the creator.
    """
    target = _directory(directory)
    if name is not None:
        NAMES.check(name)
    keeper = keeper or TmuxKeeper.from_settings(paths)
    _observed(paths, keeper)
    refused: set[str] = set()
    for _ in range(MAX_TRIES):
        with read_session(paths) as session:
            existing = {terminal.name: terminal for terminal in state.on_this_machine(session)}
            chosen = name or state.default_name(session, target, refused)
        if name is not None and (taken := existing.get(name)):
            raise HephaistosError(_taken_text(name, taken.status is TerminalStatus.LOST))
        terminal_id = new_id()
        try:
            keeper.create(terminal_id, chosen, target, command, environment)
        except NameTakenError:
            if name is not None:  # e.g. a session started by hand, not observed yet
                raise HephaistosError(_taken_text(name, lost=False)) from None
            refused.add(chosen)
            continue
        except NoSuchSessionError:
            pass  # gone already: found missing below
        hint = {terminal_id: tuple(command)} if command else None
        _observed(paths, keeper, command=hint)
        with read_session(paths) as session:
            created = state.by_id(session, terminal_id)
        if created is None or created.status is TerminalStatus.LOST:
            if created is not None or not keeper.running():
                lost = f"terminal {escaped(chosen)} was lost at once: the tmux server ended"
                raise HephaistosError(lost)
            raise HephaistosError(f"terminal {escaped(chosen)} ended at once: its command exited")
        return created
    raise HephaistosError(
        f"no free name for a terminal in {short_path(target)} after {MAX_TRIES} tries"
    )


def rename(
    paths: Paths, name: str, new_name: str, *, keeper: Keeper | None = None
) -> TerminalState:
    """Renames a Terminal; raises HephaistosError if `new_name` is invalid or taken."""
    NAMES.check(new_name)
    keeper = keeper or TmuxKeeper.from_settings(paths)
    _observed(paths, keeper)
    with read_session(paths) as session:
        found = state.by_name(session, name)
        others = {terminal.name: terminal for terminal in state.on_this_machine(session)}
    if new_name == name:
        return found
    if taken := others.get(new_name):
        raise HephaistosError(_taken_text(new_name, taken.status is TerminalStatus.LOST))
    if found.status is TerminalStatus.LOST:
        with write_session(paths) as session:
            state.rename_lost(session, found, new_name)
    else:
        try:
            keeper.rename(name, new_name)
        except NameTakenError:
            raise HephaistosError(_taken_text(new_name, lost=False)) from None
        except NoSuchSessionError:
            _observed(paths, keeper)
            raise state.NoSuchTerminalError(name) from None
    _observed(paths, keeper)
    with read_session(paths) as session:
        renamed = state.by_id(session, found.id)
    if renamed is None:
        raise state.NoSuchTerminalError(new_name)
    return renamed


#: What a restored Terminal runs first: the dim line of its hint, then the login shell.
_RESTORING = 'printf "\\033[2m%s\\033[0m\\n" "$1"; exec "$2" -l'


def _restore(
    paths: Paths, keeper: Keeper, lost: TerminalState, environment: Mapping[str, str]
) -> None:
    """Starts a lost Terminal again, with its ID, name and directory, as a shell.

    A dim line in it says so, and what it ran, which does not run again: it may have been
    anything, e.g. a deployment. Where its directory is gone, it starts in the home directory.
    """
    directory = lost.directory
    hint = "restored after a restart; earlier output is gone"
    if lost.command is not None:
        hint += f"; it ran: {shlex.join(lost.command)}"
    if not directory.is_dir() or not os.access(directory, os.X_OK):
        hint += f"; {directory} is gone, so it starts in the home directory"
        directory = Path.home()
    shell = login_shell(environment)
    command = ["sh", "-c", _RESTORING, "sh", hint, shell]
    try:
        keeper.create(lost.id, lost.name, directory, command, environment)
    except NameTakenError:  # a session started by hand meanwhile, not observed yet
        raise HephaistosError(_taken_text(lost.name, lost=False)) from None
    except NoSuchSessionError:
        raise HephaistosError(f"terminal {escaped(lost.name)} ended at once") from None
    with write_session(paths) as session:
        state.restored(session, lost)


def attach(
    paths: Paths,
    name: str,
    *,
    keeper: Keeper | None = None,
    environment: Mapping[str, str] = os.environ,
) -> tuple[TerminalState, list[str]]:
    """The Terminal named `name`, restored first if lost, and the command that attaches to it.

    `environment` is that of the process attaching: refused inside the Terminal itself, whose
    output would loop back into it.
    """
    keeper = keeper or TmuxKeeper.from_settings(paths)
    _observed(paths, keeper)
    with read_session(paths) as session:
        found = state.by_name(session, name)
    if environment.get(TERMINAL_VARIABLE) == str(found.id):
        raise HephaistosError(
            f"this is terminal {escaped(name)} itself; attach to it from another terminal emulator"
        )
    if found.status is TerminalStatus.LOST:
        _restore(paths, keeper, found, environment)
        _observed(paths, keeper)
        with read_session(paths) as session:
            found = state.by_id(session, found.id) or found
    listed = [session for session in keeper.sessions() if session.terminal_id == found.id]
    if not listed:
        raise HephaistosError(f"terminal {escaped(name)} ended meanwhile")
    return found, keeper.attach_command(listed[0])


def kill(
    paths: Paths, name: str, *, force: bool = False, keeper: Keeper | None = None
) -> TerminalState:
    """Ends a Terminal, its processes getting SIGHUP, or with `force` SIGKILL first.

    Returns it as last known. A lost one is forgotten; one that ended meanwhile counts as killed.
    """
    keeper = keeper or TmuxKeeper.from_settings(paths)
    _observed(paths, keeper)
    with read_session(paths) as session:
        found = state.by_name(session, name)
    if found.status is TerminalStatus.LOST:
        with write_session(paths) as session:
            state.forget(session, found)
    else:
        with contextlib.suppress(NoSuchSessionError):  # ended meanwhile
            keeper.kill(name, force=force)
    _observed(paths, keeper)
    return found
