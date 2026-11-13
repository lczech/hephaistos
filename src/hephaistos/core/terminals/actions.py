"""What users do to Terminals: create, attach, rename and kill them, for the CLI and the Server.

Each observes first, so that it acts on what the Keeper holds now, then acts on the Keeper
outside any transaction, then observes again: State always comes from the one comparison
(`observers/terminals.py`). A Terminal whose session is gone, lost or ended so, has none to act
on, so its row alone changes.
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


def _taken_text(name: str, status: TerminalStatus = TerminalStatus.OPEN) -> str:
    """Why `name` cannot be given: a Terminal of that status has it."""
    if status is TerminalStatus.OPEN:
        return f"a terminal named {escaped(name)} exists; choose another name"
    article = "an" if status is TerminalStatus.ENDED else "a"
    which = f"{article} {status} terminal named {escaped(name)}"
    return f"{which} exists; kill it, or choose another name"


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
    name meanwhile moves it on to the next. `environment` is that of the creator. A command that
    ended at once is returned as ended, to be seen; a shell that did is refused.
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
            raise HephaistosError(_taken_text(name, taken.status))
        terminal_id = new_id()
        try:
            keeper.create(terminal_id, chosen, target, command, environment)
        except NameTakenError:
            if name is not None:  # e.g. a session started by hand, not observed yet
                raise HephaistosError(_taken_text(name)) from None
            refused.add(chosen)
            continue
        except NoSuchSessionError:
            pass  # gone already: found missing below
        hint = {terminal_id: tuple(command)} if command else None
        _observed(paths, keeper, command=hint)
        with read_session(paths) as session:
            created = state.by_id(session, terminal_id)
        if created is None or created.session_gone:
            if created is not None or not keeper.running():
                lost = f"terminal {escaped(chosen)} was lost at once: the tmux server ended"
                raise HephaistosError(lost)
            # A command stays once ended, so this was a shell, or one killed meanwhile.
            why = ": its shell exited" if command is None else ""
            raise HephaistosError(f"terminal {escaped(chosen)} ended at once{why}")
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
        raise HephaistosError(_taken_text(new_name, taken.status))
    if found.session_gone:
        with write_session(paths) as session:
            state.rename_lost(session, found, new_name)
    else:
        try:
            keeper.rename(name, new_name)
        except NameTakenError:
            raise HephaistosError(_taken_text(new_name)) from None
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
    except NameTakenError:
        if any(session.terminal_id == lost.id for session in keeper.sessions()):
            return  # restored meanwhile by another process, e.g. a second attach
        # A session started by hand meanwhile, not observed yet.
        raise HephaistosError(_taken_text(lost.name)) from None
    except NoSuchSessionError:
        raise HephaistosError(f"terminal {escaped(lost.name)} ended at once") from None
    with write_session(paths) as session:
        state.restored(session, lost)


def _attach_command(
    keeper: Keeper, found: TerminalState, tty: str | None, *, ended: str = "ended meanwhile"
) -> list[str]:
    """The command that attaches to `found`; refused at a `tty` that it shows.

    E.g. at its own pane, or at a pane of another Terminal attached in it: its output would loop
    back into it.
    """
    listed = [session for session in keeper.sessions() if session.terminal_id == found.id]
    if not listed:
        raise HephaistosError(f"terminal {escaped(found.name)} {ended}")
    if tty is not None and keeper.shows(listed[0], tty):
        raise HephaistosError(
            f"this runs inside terminal {escaped(found.name)};"
            " attach to it from another terminal emulator"
        )
    return keeper.attach_command(listed[0])


def attach(
    paths: Paths,
    name: str,
    *,
    keeper: Keeper | None = None,
    environment: Mapping[str, str] = os.environ,
    tty: str | None = None,
) -> tuple[TerminalState, list[str]]:
    """The Terminal named `name`, restored first if lost, and the command that attaches to it.

    One ended shows its last screen, as tmux keeps it; refused if its session is gone too, e.g.
    after a reboot, as there is nothing to show. `environment` and `tty` are those of the
    process attaching: refused at a tty that the Terminal shows, as its output would loop back
    into it. Not by `HEPHAISTOS_TERMINAL`, which may have spread beyond it, e.g. into a tmux of
    the user whose server started inside it.
    """
    keeper = keeper or TmuxKeeper.from_settings(paths)
    _observed(paths, keeper)
    with read_session(paths) as session:
        found = state.by_name(session, name)
    if found.status is TerminalStatus.ENDED and found.lost_because is not None:
        raise HephaistosError(
            f"terminal {escaped(found.name)} {state.ending_text(found)}; its last screen is gone,"
            f" as {state.LOST_TEXTS[found.lost_because]}"
        )
    if found.status is TerminalStatus.LOST:
        _restore(paths, keeper, found, environment)
        _observed(paths, keeper)
        with read_session(paths) as session:
            found = state.by_id(session, found.id) or found
    return found, _attach_command(keeper, found, tty)


def attach_created(
    paths: Paths,
    created: TerminalState,
    *,
    keeper: Keeper | None = None,
    tty: str | None = None,
) -> list[str]:
    """The command that attaches to a Terminal just created, by its ID, without observing again.

    So it attaches also if renamed meanwhile, and to the last screen of a command that ended; if
    its shell exited already, or someone killed it, it says so.
    """
    keeper = keeper or TmuxKeeper.from_settings(paths)
    why = ": its shell exited" if created.command is None else ""
    return _attach_command(keeper, created, tty, ended=f"ended before attaching{why}")


def kill(
    paths: Paths, name: str, *, force: bool = False, keeper: Keeper | None = None
) -> TerminalState:
    """Ends a Terminal, its processes getting SIGHUP, or with `force` SIGKILL first.

    Returns it as last known. One ended closes, its last screen with it. One whose session is
    gone is forgotten, also one whose session went meanwhile with its server; one that closed
    meanwhile counts as killed.
    """
    keeper = keeper or TmuxKeeper.from_settings(paths)
    _observed(paths, keeper)
    with read_session(paths) as session:
        found = state.by_name(session, name)
    if not found.session_gone:
        with contextlib.suppress(NoSuchSessionError):  # closed meanwhile
            keeper.kill(name, force=force)
        _observed(paths, keeper)
        with read_session(paths) as session:
            found_now = state.by_id(session, found.id)
        if found_now is None or not found_now.session_gone:
            return found
        found = found_now  # gone meanwhile, with its server: it is forgotten as well
    with write_session(paths) as session:
        state.forget(session, found)
    _observed(paths, keeper)
    return found
