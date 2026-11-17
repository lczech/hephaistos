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
from datetime import datetime
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
from hephaistos.core.terminals.tmux import TmuxKeeper, listable, login_shell
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.ids import new_id
from hephaistos.core.utils.paths import Paths, absolute, short_path
from hephaistos.core.utils.text import escaped, is_utf8

MAX_TRIES = 100  # default names tried while others take them meanwhile


def _taken_text(name: str, status: TerminalStatus = TerminalStatus.OPEN) -> str:
    """Why `name` cannot be given: a Terminal of that status has it; one ended or lost may go."""
    if status is TerminalStatus.OPEN:
        return f"a terminal named {escaped(name)} exists; choose another name"
    article = "an" if status is TerminalStatus.ENDED else "a"
    which = f"{article} {status} terminal named {escaped(name)}"
    done = "close" if status is TerminalStatus.ENDED else "remove"
    run = shlex.join(["hephaistos", "terminal", "close", name])
    return f"{which} exists; run `{run}` to {done} it, or choose another name"


def _shell_closed_text(name: str, environment: Mapping[str, str], when: str = "") -> str:
    """Why a Terminal of a shell is gone `when`, e.g. ` before attaching`, and what to check."""
    shell = escaped(login_shell(environment))
    return (
        f"terminal {escaped(name)} closed{when}: its shell, {shell}, exited;"
        " check SHELL, or the profile of that shell"
    )


def _observed(
    paths: Paths, keeper: Keeper, command: Mapping[uuid.UUID, tuple[str, ...]] | None = None
) -> None:
    """Observes; raises HephaistosError if the Keeper cannot be asked, saying why."""
    result = observer.observe(paths, keeper, command=command)
    if result.error is not None:
        raise HephaistosError(result.error)


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
    if not listable(str(resolved)):  # tmux would hold a session we cannot read back
        path = short_path(resolved)
        raise HephaistosError(
            f"{path} holds an ASCII separator (\\x1e or \\x1f), which terminals cannot start in;"
            " choose another directory"
        )
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

    Returns it as observed right after: open, or ended if its command ended already, e.g. a typo,
    whose screen then shows why. One closed already, as its shell exited, is refused: nothing is
    left of it.
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
                lost = f"terminal {escaped(chosen)} was lost at once, as the tmux server ended"
                raise HephaistosError(f"{lost}; create it again")
            if command is None:
                raise HephaistosError(_shell_closed_text(chosen, environment))
            # A command stays once ended: someone closed it.
            raise HephaistosError(f"terminal {escaped(chosen)} closed meanwhile")
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


def _time_text(value: datetime) -> str:
    """A time for a line in a Terminal, local, to the minute: `2026-11-16 18:03`."""
    return value.astimezone().strftime("%Y-%m-%d %H:%M")


#: What a restored Terminal runs first: the dim line of its hint, then the login shell.
_RESTORING = 'printf "\\033[2m%s\\033[0m\\n" "$1"; exec "$2" -l'


def _restore(
    paths: Paths, keeper: Keeper, lost: TerminalState, environment: Mapping[str, str]
) -> None:
    """Starts a lost Terminal again, with its ID, name and directory, as a shell.

    A dim line in it says so: that it is a new shell, why it was lost, when that was noticed and
    when it was last active, and what it ran, which does not start again: it may have been
    anything, e.g. a deployment. Where its directory is gone, it starts in the home directory.
    """
    directory = lost.directory
    why = "its session went" if lost.lost_because is None else state.LOST_TEXTS[lost.lost_because]
    noticed = "" if lost.noticed_at is None else f"noticed {_time_text(lost.noticed_at)}; "
    hint = (
        f"hephaistos restored this terminal as a new shell, as {why}"
        f" ({noticed}last active {_time_text(lost.active_at)}); earlier output is gone"
    )
    if lost.command is not None:
        hint += f"; it ran {escaped(shlex.join(lost.command))}, which does not start again"
    if not directory.is_dir() or not os.access(directory, os.X_OK):
        hint += f"; {short_path(directory)} is gone, so it starts in the home directory"
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
        raise HephaistosError(
            _shell_closed_text(lost.name, environment, " as it was restored")
        ) from None
    with write_session(paths) as session:
        state.restored(session, lost)


def _attach_command(
    keeper: Keeper, found: TerminalState, tty: str | None, *, gone: str | None = None
) -> list[str]:
    """The command that attaches to `found`; refused at a `tty` that it shows.

    E.g. at its own pane, or at a pane of another Terminal attached in it: its output would loop
    back into it.
    """
    listed = [session for session in keeper.sessions() if session.terminal_id == found.id]
    if not listed:
        raise HephaistosError(gone or f"terminal {escaped(found.name)} closed meanwhile")
    if tty is not None and keeper.shows(listed[0], tty):
        raise HephaistosError(
            f"this command runs inside terminal {escaped(found.name)}, which cannot show itself;"
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
        what = "shell" if found.command is None else "command"
        close = shlex.join(["hephaistos", "terminal", "close", found.name])
        why = state.LOST_TEXTS[found.lost_because]
        raise HephaistosError(
            f"the {what} of terminal {escaped(found.name)} {state.ending_text(found)}, and its last"
            f" screen is gone, as {why}; run `{close}` to remove it"
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
    environment: Mapping[str, str] = os.environ,
    tty: str | None = None,
) -> list[str]:
    """The command that attaches to a Terminal just created, by its ID, without observing again.

    So it attaches also if renamed meanwhile, and to the last screen of a command that ended; if
    its shell exited already, or someone closed it, it says so. `environment` is that of the
    creator, as for `create`.
    """
    keeper = keeper or TmuxKeeper.from_settings(paths)
    if created.command is None:
        gone = _shell_closed_text(created.name, environment, " before attaching")
    else:
        gone = f"terminal {escaped(created.name)} closed before attaching"
    return _attach_command(keeper, created, tty, gone=gone)


def close(
    paths: Paths, name: str, *, force: bool = False, keeper: Keeper | None = None
) -> TerminalState:
    """Closes a Terminal, its processes getting SIGHUP, or with `force` kills it: SIGKILL first.

    Returns it as last known. One ended closes, its last screen with it. The row of one whose
    session is gone is removed, also of one whose session went meanwhile with its server; one
    that closed meanwhile counts as closed.
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
