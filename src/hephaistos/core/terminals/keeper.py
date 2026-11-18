"""What keeps Terminals alive: the interface the Core uses, whichever tool implements it.

A Keeper holds the process of each Terminal and its output while nothing shows it. It knows
nothing of the database; the Core compares its sessions with the State it stores.
"""

import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Protocol

from hephaistos.core.utils.errors import HephaistosError

#: The variable that tells the programs in a Terminal which Terminal they run in: its ID.
TERMINAL_VARIABLE = "HEPHAISTOS_TERMINAL"


class KeeperError(HephaistosError):
    """The Keeper failed, or cannot run here."""


class NameTakenError(KeeperError):
    """A session of that name exists already."""


class NoSuchSessionError(KeeperError):
    """No session has that name."""


@dataclass(frozen=True)
class Ending:
    """How the program of a session ended; its pane stays, showing its last screen."""

    status: int | None  # its exit status; None if a signal ended it
    signal: int | None  # the signal that ended it; None if it exited, or the Keeper does not say
    at: datetime | None  # when it ended; None if the Keeper does not say


@dataclass(frozen=True, kw_only=True)
class Session:
    """A Terminal as its Keeper sees it at one moment."""

    key: str  # the ID the Keeper itself gives it, e.g. `$3` in tmux
    terminal_id: uuid.UUID | None  # ours; None until adopted, or if `id_text` is not one
    id_text: str  # as the Keeper holds it: empty until adopted
    name: str
    directory: Path  # where it started
    current_directory: Path | None  # where its foreground process is; None if unknown
    # What runs in the foreground, e.g. `bash` or `vim`; while it starts, or once ended, what it
    # started. Empty where neither is known, e.g. for a session started by hand.
    program: str
    pid: int | None  # of the process it started, e.g. the shell; None once ended, if not said
    attached: int  # clients attached to it, e.g. Terminal emulators showing it
    created_at: datetime
    active_at: datetime  # when it last had input or output
    panes: int  # more than 1 if someone split it outside hephaistos; the first one counts
    ending: Ending | None = None  # how its program ended; None while it runs


@dataclass(frozen=True)
class Listing:
    """All sessions of a Keeper at one moment."""

    sessions: list[Session]
    #: The IDs of those it could not read, e.g. renamed by hand to no name: they still run.
    unreadable: frozenset[uuid.UUID] = frozenset()


class Keeper(Protocol):
    """Keeps Terminals alive: creates, lists, renames and kills them."""

    def check(self) -> None:
        """Raises KeeperError unless the Keeper can run here, e.g. a tool missing or too old."""
        ...

    def running(self) -> bool:
        """Whether its server runs: if not, it crashed, was killed, or the Machine rebooted."""
        ...

    def sessions(self) -> list[Session]:
        """All sessions, of every Terminal; empty if none run, e.g. after a reboot."""
        ...

    def listing(self) -> Listing:
        """All sessions, as `sessions`, and the IDs of those it could not read."""
        ...

    def create(  # noqa: PLR0913 - `size` keyword-only
        self,
        terminal_id: uuid.UUID,
        name: str,
        directory: Path,
        command: Sequence[str] | None,
        environment: Mapping[str, str],
        *,
        size: tuple[int, int] | None = None,
    ) -> Session:
        """Starts a session in `directory`: `command`, else the login shell of the creator.

        `environment` is that of the creator, e.g. of a shell: the Terminal gets the variables
        that a terminal emulator passes on, such as DISPLAY and SSH_AUTH_SOCK, from it.
        `size`, columns and rows, is that of the terminal about to attach, if any: started so,
        it is not resized as that attaches, which redraws what its program shows.
        Raises NameTakenError if `name` is taken.

        Once its program ends, the session of a command stays, ended, showing its last screen, as
        does that of any program a signal ended; that of a shell which exited closes, as a tab of a
        terminal emulator does. So a session made by hand counts as a shell.
        """
        ...

    def adopt(self, session: Session, terminal_id: uuid.UUID) -> uuid.UUID | None:
        """Gives a session `terminal_id`, unless its ID changed since `session` was listed.

        For a session found without an ID, e.g. one started by hand, or with one that is not
        valid or is that of another. Returns the ID it has then, which another process may have
        given it meanwhile; None if it is gone.
        """
        ...

    def rename(self, name: str, new_name: str) -> None:
        """Renames a session; raises NoSuchSessionError, or NameTakenError for `new_name`."""
        ...

    def kill(self, name: str, *, force: bool = False) -> None:
        """Ends a session, its processes getting SIGHUP; raises NoSuchSessionError.

        With `force`, they get SIGKILL first, which also ends those that ignore SIGHUP. One that
        ended closes.
        """
        ...

    def shows(self, session: Session, tty: str) -> bool:
        """Whether `session` shows the terminal at `tty`, which attaching there would loop.

        So it does if `tty` is one of its panes, or that of a session attached in one of them,
        and so on. A tty that a Terminal shows through another Keeper, e.g. the tmux of the
        user, is not found.
        """
        ...

    def attach_command(self, session: Session) -> list[str]:
        """The command that attaches the terminal emulator it runs in to `session`."""
        ...
