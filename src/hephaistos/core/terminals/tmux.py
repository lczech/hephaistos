"""tmux as the Keeper: one session with one pane per Terminal, on a socket of our own.

Every call runs the tmux client with our socket (`-L`) and our generated config (`-f`), so the
tmux of the user and `~/.tmux.conf` never come into it. Where the systemd user manager answers,
the server starts in a scope of its own, with the environment of that manager, and the process
of each Terminal in another one; see `scopes`.
"""

import dataclasses
import hashlib
import logging
import os
import pwd
import re
import shutil
import socket
import subprocess
import tempfile
import uuid
from collections.abc import Callable, Mapping, Sequence
from datetime import UTC, datetime
from functools import cached_property
from pathlib import Path

from hephaistos.core import config
from hephaistos.core.terminals.keeper import (
    TERMINAL_VARIABLE,
    Ending,
    KeeperError,
    Listing,
    NameTakenError,
    NoSuchSessionError,
    Session,
)
from hephaistos.core.utils import scopes as scopes_module
from hephaistos.core.utils.paths import HOME_VARIABLE, Paths
from hephaistos.core.utils.scopes import Scopes

log = logging.getLogger(__name__)

MINIMUM = (3, 2)  # 3.2a in practice: subscriptions, flow control and extended keys need it
MINIMUM_TEXT = "3.2a"
#: The first that reaps the process of each pane also when built with utempter; see `config_text`.
REAPS = (3, 6)
#: The first whose line in a dead pane we can extend, by `remain-on-exit-format`.
HINTS = (3, 3)
TIMEOUT = 10.0  # seconds for one tmux command; tmux is local, so only a hung one takes long
DEFAULT_SOCKET = "hephaistos"
CONFIG_NAME = "tmux.conf"  # in the state directory

#: What tmux sets in each Terminal, removed there so that tmux stays out of sight.
HIDDEN = ("TMUX", "TMUX_PANE")
#: What we start a program with, each running until it executes the program: what tmux gives as
#: the program of a pane while it starts, and of a dead pane. Not that of the Terminal.
WRAPPERS = frozenset({"env", "systemd-run"})

#: Our options: on a session, the ID of its Terminal; on the pane of a command, a marker that
#: it is one, which keeps it once ended; on a pane kept once ended, a marker that our hook kept
#: it; on the server, the config marker, and one for the job that reaps.
ID_OPTION = "@hephaistos_id"
COMMAND_OPTION = "@hephaistos_command"
ENDED_OPTION = "@hephaistos_ended"
CONFIG_OPTION = "@hephaistos_config"
REAPING_OPTION = "@hephaistos_reaping"  # on the server, once its job that reaps runs

#: What a terminal emulator passes on to a new tab: the `update-environment` defaults of tmux,
#: with the Wayland display and the D-Bus session bus. A new Terminal takes them from its creator.
UPDATED_VARIABLES = (
    "DISPLAY",
    "KRB5CCNAME",
    "SSH_ASKPASS",
    "SSH_AUTH_SOCK",
    "SSH_AGENT_PID",
    "SSH_CONNECTION",
    "WINDOWID",
    "XAUTHORITY",
    "WAYLAND_DISPLAY",
    "DBUS_SESSION_BUS_ADDRESS",
)

#: The fields of one pane in `list-panes`. tmux prints paths as they are, tabs and newlines
#: included; since 3.3 or so, it writes other control characters as octal escapes, e.g. `\037`,
#: leaving backslashes alone. So no separator is impossible: fields are separated by a tab, a
#: Unit Separator and a tab, and panes ended by a Record Separator and a newline, escaped or
#: not; a path holding those exactly would change the number of fields, which is checked.
_FIELDS = (
    "#{session_id}",
    f"#{{{ID_OPTION}}}",
    "#{session_name}",
    "#{session_path}",
    "#{pane_current_path}",
    "#{pane_current_command}",
    "#{pane_pid}",
    "#{session_attached}",
    "#{session_created}",
    "#{session_activity}",
    "#{pane_dead}",
    f"#{{{ENDED_OPTION}}}",
    "#{pane_dead_status}",  # empty if a signal ended it
    "#{pane_dead_signal}",  # since 3.3; empty before
    "#{pane_dead_time}",  # since 3.3; empty before
    f"#{{{CONFIG_OPTION}}}",
)
_SEPARATOR = "\t\x1f\t"
_END = "\x1e\n"
_FORMAT = _SEPARATOR.join(_FIELDS) + _END.rstrip("\n")
_ESCAPED = {"\t\\037\t": _SEPARATOR, "\\036\n": _END}  # as newer tmux prints them


def listable(path: str) -> bool:
    """Whether a session that starts in `path` reads back from our listing.

    Not if the path holds a separator of it, as such or as tmux escapes it: its fields would not
    add up.
    """
    return not any(mark in path for mark in ("\x1e", "\x1f", *_ESCAPED))


# A failed command is told apart by state, never by the message of tmux, which only goes into
# ours (docs/development.md): whether the server answers on its socket, whether a session is
# still listed, whether a name is taken.


def parse_version(text: str) -> tuple[int, int] | None:
    """The version that `tmux -V` names, e.g. `tmux 3.2a` → (3, 2); `next-3.6` counts as 3.6.

    None if it names none, e.g. `tmux master`, or `tmux openbsd-7.5` on OpenBSD.
    """
    match = re.fullmatch(r"tmux (?:next-)?(\d+)\.(\d+)[a-z]?_?", text.strip())
    return (int(match[1]), int(match[2])) if match else None


@dataclasses.dataclass(frozen=True)
class Installation:
    """The tmux that we run."""

    executable: str
    text: str  # as `tmux -V` says it, e.g. `tmux 3.4`

    @property
    def version(self) -> tuple[int, int] | None:
        """Its version; None if it names none, e.g. `tmux master`."""
        return parse_version(self.text)

    @property
    def too_old(self) -> bool:
        """Whether it is older than we need; one that names no version is not."""
        version = self.version
        return version is not None and version < MINIMUM

    @property
    def may_miss_exits(self) -> bool:
        """Whether it may fail to reap the process of a pane: older than 3.6; see `config_text`."""
        version = self.version
        return version is not None and version < REAPS

    @property
    def hints(self) -> bool:
        """Whether we can extend the line it shows in a dead pane: since 3.3; see `config_text`."""
        version = self.version
        return version is None or version >= HINTS


def binary() -> str:
    """The tmux to run: `terminals.tmux.path`, found on the PATH unless it is a path."""
    path = config.settings().terminals.tmux.path
    return shutil.which(path) or path


#: What to do without tmux, or with one too old.
INSTALL_TEXT = f"install tmux {MINIMUM_TEXT} or later, or set terminals.tmux.path to one"


class MissingError(KeeperError):
    """tmux is not installed: there are no Terminals without it."""

    def __init__(self, binary: str) -> None:
        """The error for `binary` not found; `problem` says that without what to do."""
        self.problem = f"tmux is not installed ({binary} not found)"
        super().__init__(f"{self.problem}; {INSTALL_TEXT}")


def installation(binary: str, timeout: float = TIMEOUT) -> Installation:
    """The tmux that `binary` runs; raises KeeperError if it is not there or fails."""
    try:
        result = subprocess.run(  # noqa: S603 - arguments are a list, never passed through a shell
            [binary, "-V"], capture_output=True, text=True, check=False, timeout=timeout
        )
    except FileNotFoundError:
        raise MissingError(binary) from None
    except (OSError, subprocess.SubprocessError) as error:
        raise KeeperError(f"tmux failed: {error}") from None
    if result.returncode != 0:
        detail = result.stderr.strip() or f"exit code {result.returncode}"
        raise KeeperError(f"tmux -V failed: {detail}")
    return Installation(binary, result.stdout.strip())


_ESCAPE = re.compile(rb"\\([0-3][0-7]{2}|[abfrv$])")
_C_ESCAPES = {b"a": b"\a", b"b": b"\b", b"f": b"\f", b"r": b"\r", b"v": b"\v", b"$": b"$"}


def _unescaped(match: re.Match[bytes]) -> bytes:
    code = match[1]
    return _C_ESCAPES.get(code) or bytes([int(code, 8)])


def tmux_path(text: str) -> Path:
    r"""A path as tmux prints it, its escapes read where that names an existing path.

    Some builds, e.g. 3.4 on Ubuntu, write control characters and bytes that are not UTF-8 as
    escapes, `\037` or `\b` as in C, and `$` as `\$`, but a backslash as itself (those of
    conda-forge print them as they are): the escapes count where the path so read exists and the
    text as printed does not.
    """
    printed = Path(text)
    if "\\" not in text:
        return printed
    decoded = Path(os.fsdecode(_ESCAPE.sub(_unescaped, os.fsencode(text))))
    return decoded if decoded != printed and decoded.exists() and not printed.exists() else printed


def scope_of(pid: int | None) -> str | None:
    """The systemd scope a process runs in, from its cgroup (v2); None if in none, or ended."""
    if pid is None:
        return None
    try:
        text = Path(f"/proc/{pid}/cgroup").read_text()
    except OSError:
        return None
    for line in text.splitlines():
        if line.startswith("0::"):
            unit = line.rsplit("/", 1)[-1]
            return unit if unit.endswith(".scope") else None
    return None


def socket_name(setting: str, env: Mapping[str, str] = os.environ) -> str:
    """The name of the socket for the setting `terminals.tmux.socket`.

    `auto` gives `hephaistos`, or with HEPHAISTOS_HOME, a name unique to that directory, so that
    tests and scratch Daemons keep apart from the real Terminals.
    """
    if setting != "auto":
        return setting
    home = env.get(HOME_VARIABLE)
    if not home:
        return DEFAULT_SOCKET
    digest = hashlib.sha256(os.fsencode(Path(home).resolve())).hexdigest()
    return f"{DEFAULT_SOCKET}-{digest[:10]}"


def config_text(history: int, *, reaping: bool = False, hinting: bool = False) -> str:
    """Our tmux config, ending with the marker that names it by its hash.

    The defaults of tmux, with only what the server needs on top; never the config of the user.
    The look and the keys stay those of tmux, but for Ctrl+D in a dead pane, so that attaching
    from the CLI is plain tmux; a client in control mode, as the GUI uses, shows no status bar and
    runs no key bindings. The server outlives its last session, so that no server means it crashed
    or was killed.

    A pane whose program ended stays, showing its last screen, unless it is not that of a command
    and its program exited: then the hook closes it at once, as a terminal emulator closes the tab
    of a shell that exited. So the pane of a command stays, and any a signal ended; the hook marks
    those it keeps. tmux runs it once it knows how the program ended, which it may learn only after
    the pane counts as dead: until then, a pane is not taken as ended.

    Ctrl+D closes a dead pane, as it closes a shell, and passes on to any other; with `hinting`,
    tmux 3.3 or later, the line tmux shows in a dead pane ends saying so.

    tmux before 3.6, built with utempter as Ubuntu's and Debian's are, sometimes misses the end of
    the process of a pane (tmux issue 4559), and so never runs the hook: the pane would stay dead,
    blank, until another child of the server ended. With `reaping`, a job of the server sends it
    SIGCHLD twice a second, as tmux 3.6 does itself, until the server ends; one job per server.
    """
    variables = " ".join(UPDATED_VARIABLES)
    body = f"""\
# The tmux config of hephaistos, generated from its settings: changes here are overwritten.
# The defaults of tmux, with only what its server needs on top.
set -g default-terminal xterm-256color
set -as terminal-features ",*:RGB"
set-environment -g COLORTERM truecolor
set -g extended-keys on
set -g focus-events on
set -s escape-time 10
set -s exit-empty off
set -g history-limit {history}
set -g update-environment "{variables}"
set -g remain-on-exit on
set-hook -g pane-died {{ if-shell -F "{_CLOSED}" kill-pane "set-option -p {ENDED_OPTION} 1" }}
bind -n C-d if-shell -F "#{{pane_dead}}" kill-pane "send-keys C-d"
"""
    if hinting:
        body += f'set -g remain-on-exit-format "{_DEAD_LINE}"\n'
    if reaping:  # once per server: sourced again, the config finds the job running
        job = f'set -g {REAPING_OPTION} 1 ; run-shell -b "{_REAPING}"'
        body += f'if-shell -F "#{{{REAPING_OPTION}}}" "" {{ {job} }}\n'
    digest = hashlib.sha256(body.encode()).hexdigest()[:12]
    return f"{body}set -g {CONFIG_OPTION} {digest}\n"


#: The line tmux shows in a dead pane, with `hinting`: what ended, how and when, and that Ctrl+D
#: closes it, e.g. `Command exited with status 1 at 2026-11-16 18:03; press Ctrl+D to close it`.
#: Short, as tmux cuts it at the width of the pane; the signal by its number, all tmux gives.
_DEAD_LINE = (
    f"#{{?#{{==:#{{{COMMAND_OPTION}}},1}},Command,Shell}} "
    "#{?#{!=:#{pane_dead_signal},},ended by signal #{pane_dead_signal},"
    "#{?#{==:#{pane_dead_status},0},finished,exited with status #{pane_dead_status}}}"
    " at #{t/f/%Y-%m-%d %H#:%M:pane_dead_time}; press Ctrl+D to close it"
)

#: What the job that reaps for tmux before 3.6 runs: it ends with the server.
_REAPING = "while kill -s CHLD #{pid} 2>/dev/null; do sleep 0.5; done"

#: Whether the hook closes a pane that died: its program exited, and it is not that of a command.
_CLOSED = f"#{{&&:#{{!=:#{{pane_dead_status}},}},#{{!=:#{{{COMMAND_OPTION}}},1}}}}"


def config_digest(text: str) -> str:
    """The hash that the marker in `text` names."""
    return text.rstrip("\n").rsplit(" ", 1)[-1]


def _literal(text: str) -> str:
    """Text tmux expands as a format, e.g. the name or directory of a new session, kept as it is.

    Each `#` doubled, except in a run of them before `[`, which tmux keeps as it is (a style).
    """
    return _escaped(_HASHES.sub(lambda run: run[0] if run[2] else run[1] * 2, text))


_HASHES = re.compile(r"(#+)(\[?)")


def _escaped(argument: str) -> str:
    """An argument as tmux reads it literally: one ending in `;` would end a command there.

    Every argument holding a name, a path or a value goes through it.
    """
    return f"{argument[:-1]}\\;" if argument.endswith(";") else argument


def login_shell(environment: Mapping[str, str]) -> str:
    """The shell of the user: SHELL in the environment of the creator, else that of the account."""
    return environment.get("SHELL") or pwd.getpwuid(os.getuid()).pw_shell or "/bin/sh"


#: Sessions without a name already logged, by socket and ID: once is enough, not each pass.
_UNNAMED: set[tuple[str, str]] = set()


def _id(text: str) -> uuid.UUID | None:
    """The ID of a Terminal as tmux holds it; None if none, or not one."""
    try:
        return uuid.UUID(text) if text else None
    except ValueError:
        return None


def _time(text: str) -> datetime:
    return datetime.fromtimestamp(int(text), UTC)


def _ending(dead: str, kept: str, status: str, signal: str, at: str) -> Ending | None:
    """How the program of a pane ended, from its fields; None while it runs.

    Only once our hook `kept` it, as tmux then knows how; not if it runs again, respawned by hand.
    """
    if dead != "1" or kept != "1":
        return None
    return Ending(
        status=int(status) if status else None,
        signal=int(signal) if signal and not status else None,
        at=_time(at) if at else None,
    )


class TmuxKeeper:
    """Keeps Terminals alive in tmux; see the module docstring."""

    def __init__(  # noqa: PLR0913 - keyword-only, each a setting or a stand-in for tests
        self,
        *,
        binary: str,
        socket: str,
        config_file: Path,
        history: int,
        detect_scopes: Callable[[], Scopes | None] = scopes_module.detect,
        timeout: float = TIMEOUT,
    ) -> None:
        """A Keeper running `binary` on `socket`, its config written to `config_file`."""
        self.binary = binary
        self.socket = socket
        self.config_file = config_file
        self.history = history
        self.config = config_text(history)  # until `check` knows the version of tmux
        self.timeout = timeout
        self._detect_scopes = detect_scopes
        self._checked = False

    @classmethod
    def from_settings(cls, paths: Paths, env: Mapping[str, str] = os.environ) -> "TmuxKeeper":
        """The Keeper as the settings of this Machine describe it."""
        settings = config.settings().terminals
        return cls(
            binary=binary(),
            socket=socket_name(settings.tmux.socket, env),
            config_file=paths.state_dir / CONFIG_NAME,
            history=settings.history,
        )

    @cached_property
    def scopes(self) -> Scopes | None:
        """The systemd user manager, asked once, when first needed."""
        return self._detect_scopes()

    # Running tmux.

    def _options(self) -> list[str]:
        """What every tmux command of ours starts with: UTF-8, our socket and our config."""
        # -u: UTF-8 whatever the locale, else tmux prints `_` for each other character.
        return ["-u", "-L", self.socket, "-f", str(self.config_file)]

    def _client(
        self, *args: str, env: Mapping[str, str] | None = None, scoped: bool = False
    ) -> subprocess.CompletedProcess[str]:
        """Runs a tmux command on our socket; `scoped`, in a scope, with the systemd environment."""
        command = [self.binary, *self._options(), *args]
        if scoped and self.scopes:
            command = self.scopes.command(command, unit=None, description="hephaistos tmux server")
            # The directory of the socket is that of the caller, whatever the environment of the
            # manager says.
            keep = {name: os.environ[name] for name in ("TMUX_TMPDIR",) if name in os.environ}
            env = {**self.scopes.environment, **keep}
        try:
            result = subprocess.run(  # noqa: S603 - arguments are a list, never passed through a shell
                command, capture_output=True, check=False, timeout=self.timeout, env=env
            )
        except FileNotFoundError:
            raise MissingError(self.binary) from None
        except subprocess.TimeoutExpired:
            raise KeeperError(f"tmux did not answer within {self.timeout:g} s") from None
        except OSError as error:
            raise KeeperError(f"tmux failed: {error}") from None
        # Decoded here, not in text mode, whose universal newlines would turn a `\r` in a path into
        # `\n`; bytes that are not UTF-8 survive the round trip as surrogates.
        return subprocess.CompletedProcess(
            result.args,
            result.returncode,
            result.stdout.decode(errors="surrogateescape"),
            result.stderr.decode(errors="surrogateescape"),
        )

    def _failed(self, args: Sequence[str], result: subprocess.CompletedProcess[str]) -> KeeperError:
        """The error for a failed tmux command."""
        detail = result.stderr.strip() or f"exit code {result.returncode}"
        return KeeperError(f"tmux {args[0]} failed: {detail}")

    def _write_config(self) -> None:
        """Writes our config, unless the file holds it already.

        Atomically, as other processes may start a server from it meanwhile.
        """
        try:
            if self.config_file.read_text() == self.config:
                return
        except OSError:
            pass
        self.config_file.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            "w", dir=self.config_file.parent, prefix=f".{self.config_file.name}.", delete=False
        ) as partial:
            partial.write(self.config)
        Path(partial.name).replace(self.config_file)

    def check(self) -> None:
        """Raises KeeperError unless tmux is here and new enough; writes our config."""
        if self._checked:
            return
        found = installation(self.binary, self.timeout)
        if found.version is None:
            log.warning("unknown tmux version %r: taken as new enough", found.text)
        elif found.too_old:
            raise KeeperError(
                f"{found.text} is too old: Terminals need tmux {MINIMUM_TEXT} or later;"
                " install a newer one, e.g. without root, and set terminals.tmux.path to it"
            )
        self.config = config_text(self.history, reaping=found.may_miss_exits, hinting=found.hints)
        self._write_config()
        self._checked = True

    # Sessions.

    def _parsed(self, record: str) -> tuple[Session, str] | uuid.UUID | None:
        """The session of a pane and the config marker its server has.

        If malformed, logged, the ID of its Terminal, if it reads; else None. The ID reads
        whatever a name or path holds, as it comes before them, after the key, e.g. `$3`.
        """
        fields = record.split(_SEPARATOR)
        if len(fields) != len(_FIELDS):
            log.warning("skipped a tmux session we cannot read: %r", record[:200])
            return _id(fields[1]) if len(fields) > 1 else None
        (
            key,
            terminal_id,
            name,
            directory,
            current,
            program,
            pid,
            clients,
            created,
            active,
            dead,
            kept,
            dead_status,
            dead_signal,
            dead_time,
            marker,
        ) = fields
        if not name:  # e.g. one made by hand as `#`, which tmux 3.8 expands to nothing
            if (self.socket, key) not in _UNNAMED:
                _UNNAMED.add((self.socket, key))
                log.warning("left tmux session %s alone: it has no name; rename it to see it", key)
            return _id(terminal_id)
        try:
            parsed_id = uuid.UUID(terminal_id) if terminal_id else None
        except ValueError:
            log.warning("tmux session %s has an ID that is not one: %r", name, terminal_id)
            parsed_id = None
        try:
            session = Session(
                key=key,
                terminal_id=parsed_id,
                id_text=terminal_id,
                name=name,
                directory=tmux_path(directory),
                current_directory=tmux_path(current) if current else None,
                program="" if program in WRAPPERS else program,
                pid=int(pid) if pid else None,  # a dead pane holds none since 3.8
                clients=int(clients),
                created_at=_time(created),
                active_at=_time(active),
                panes=1,
                ending=_ending(dead, kept, dead_status, dead_signal, dead_time),
            )
        except ValueError:
            log.warning("skipped a tmux session we cannot read: %r", record[:200])
            return parsed_id
        return session, marker

    def sessions(self) -> list[Session]:
        """All sessions, each as its first pane, with the number of its panes."""
        return self.listing().sessions

    def listing(self) -> Listing:
        """All sessions, as `sessions`, and the IDs of those it could not read."""
        self.check()
        result = self._client("list-panes", "-a", "-F", _FORMAT)
        if result.returncode != 0:
            if not self.running() or not self._keys():  # no server, or one without sessions
                return Listing([])
            raise self._failed(["list-panes"], result)
        found: dict[str, Session] = {}
        unreadable: set[uuid.UUID] = set()
        markers: set[str] = set()
        output = result.stdout
        for escaped, raw in _ESCAPED.items():
            output = output.replace(escaped, raw)
        for record in output.split(_END):
            if not record or (parsed := self._parsed(record)) is None:
                continue
            if isinstance(parsed, uuid.UUID):
                unreadable.add(parsed)
                continue
            session, marker = parsed
            markers.add(marker)
            if (first := found.get(session.key)) is None:
                found[session.key] = session
            else:  # a later pane of a session split outside hephaistos: counted only
                found[session.key] = dataclasses.replace(first, panes=first.panes + 1)
        if markers - {config_digest(self.config)}:
            self._load_config()
        # A pane read, of a session with another pane that is not, still lists it.
        readable = {session.terminal_id for session in found.values()}
        return Listing(list(found.values()), frozenset(unreadable - readable))

    def _load_config(self) -> None:
        """Loads our config into a running server that lacks it, e.g. one started by hand."""
        log.info("loading our tmux config into the server on socket %s", self.socket)
        result = self._client("source-file", _escaped(str(self.config_file)))
        if result.returncode != 0 and self.running():
            raise self._failed(["source-file"], result)

    @property
    def socket_path(self) -> Path:
        """Where tmux puts the socket that `-L` names: `$TMUX_TMPDIR/tmux-<uid>/`, else in /tmp."""
        directory = Path(os.environ.get("TMUX_TMPDIR") or "/tmp")  # noqa: S108 - as tmux does
        return directory / f"tmux-{os.getuid()}" / self.socket

    def running(self) -> bool:
        """Whether a server answers on our socket; a socket left by one that crashed does not."""
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as probe:
            probe.settimeout(self.timeout)
            try:
                probe.connect(str(self.socket_path))
            except (FileNotFoundError, ConnectionRefusedError):
                return False
            except OSError as error:
                where = self.socket_path
                raise KeeperError(f"cannot reach the tmux server at {where}: {error}") from None
        return True

    def _keys(self) -> set[str]:
        """The IDs that tmux gives the sessions, e.g. `$3`; none without a server."""
        result = self._client("list-sessions", "-F", "#{session_id}")
        if result.returncode != 0:
            if not self.running():
                return set()
            raise self._failed(["list-sessions"], result)
        return set(result.stdout.split())

    def _taken(self, name: str, *, by_other_than: str | None = None) -> bool:
        """Whether a session is named `name`, other than the one with the ID `by_other_than`."""
        return any(s.name == name and s.key != by_other_than for s in self.sessions())

    def session(self, name: str) -> Session:
        """The session named `name`; raises NoSuchSessionError."""
        for session in self.sessions():
            if session.name == name:
                return session
        raise NoSuchSessionError(f"no terminal named {name}")

    def create(
        self,
        terminal_id: uuid.UUID,
        name: str,
        directory: Path,
        command: Sequence[str] | None,
        environment: Mapping[str, str],
    ) -> Session:
        """Starts a session; see `Keeper.create`.

        Its ID is set by the same command list, so nobody sees it without one, and so is the
        marker of a command, which keeps its pane once ended, also one that ends at once.

        With systemd, its process runs in a scope of its own, `hephaistos-terminal-<id>.scope`. A
        tmux built with systemd support, e.g. that of Ubuntu, moves each new pane into its own
        `tmux-spawn-*.scope` too, from the server, while the pane starts: whichever move comes last
        holds it, as isolated either way.
        """
        self.check()
        variables = {name: environment[name] for name in UPDATED_VARIABLES if name in environment}
        variables[TERMINAL_VARIABLE] = str(terminal_id)
        pairs = [arg for item, value in variables.items() for arg in ("-e", f"{item}={value}")]
        program = list(command) if command else [login_shell(environment), "-l"]
        # tmux sets these for each program it starts, with no option against it. Without them, a
        # `tmux` typed in the Terminal reaches the tmux of the user, as from any terminal emulator.
        program = ["env", *(arg for name in HIDDEN for arg in ("-u", name)), *program]
        if self.scopes:
            program = self.scopes.command(
                program,
                unit=f"hephaistos-terminal-{terminal_id}",
                description=f"hephaistos terminal {name}",
            )
        args = [
            "new-session", "-d", "-s", _literal(name), "-c", _literal(str(directory)),
            *map(_escaped, pairs),
            *map(_escaped, program),
            ";", "set-option", ID_OPTION, str(terminal_id),  # without a target: the new session
            *([";", "set-option", "-p", COMMAND_OPTION, "1"] if command else []),  # its pane
        ]  # fmt: skip
        result = self._client(*args, scoped=not self.running())
        if result.returncode != 0:
            if self._taken(name):
                raise NameTakenError(f"a terminal named {name} exists already")
            raise self._failed(args, result)
        return self.session(name)

    def adopt(self, session: Session, terminal_id: uuid.UUID) -> uuid.UUID | None:
        """Sets the ID of the session; see `Keeper.adopt`.

        tmux compares and sets in one command, so two processes adopting at once agree. The
        session is named by its key, `$3`, single-quoted against tmux expanding `$`. An ID
        set by hand to text that cannot go into the comparison is replaced without one.
        """
        self.check()
        if not re.fullmatch(r"\$\d+", session.key):
            raise KeeperError(f"tmux session key {session.key!r} is not one")
        command = f"set-option -t '{session.key}' {ID_OPTION} {terminal_id}"
        if re.fullmatch(r"[\w-]*", session.id_text):
            condition = f"#{{==:#{{{ID_OPTION}}},{session.id_text}}}"
            setting = ["if-shell", "-F", "-t", session.key, condition, command]
        else:
            setting = ["set-option", "-t", session.key, ID_OPTION, str(terminal_id)]
        shown = f"#{{session_id}} #{{{ID_OPTION}}}"
        result = self._client(*setting, ";", "display-message", "-p", "-t", session.key, shown)
        if result.returncode != 0:
            if session.key not in self._keys():  # gone meanwhile
                return None
            raise self._failed(["if-shell"], result)
        key, _, found = result.stdout.strip().partition(" ")
        if key != session.key:  # gone: tmux showed another session instead
            return None
        try:
            return uuid.UUID(found)
        except ValueError:
            return None

    def rename(self, name: str, new_name: str) -> None:
        r"""Renames a session; see `Keeper.rename`.

        Targeted by its ID, as tmux may print a name otherwise than it takes it, e.g. `a$b` as
        `a\$b` on Ubuntu; so for `kill`.
        """
        self.check()
        key = self.session(name).key
        result = self._client("rename-session", "-t", key, _literal(new_name))
        if result.returncode != 0:
            if key not in self._keys():
                raise NoSuchSessionError(f"no terminal named {name}")
            if self._taken(new_name, by_other_than=key):
                raise NameTakenError(f"a terminal named {new_name} exists already")
            raise self._failed(["rename-session"], result)

    def shows(self, session: Session, tty: str) -> bool:
        """Whether `session` shows the terminal at `tty`; see `Keeper.shows`.

        From its panes to the sessions that clients in them show, and on, by their ttys. Not by
        those of dead panes: tmux keeps the name of a pty it closed, which another may have now.
        """
        self.check()
        live = "#{session_id}\t#{?pane_dead,,#{pane_tty}}"
        panes = self._listed("list-panes", "-a", "-F", live)
        clients = self._listed("list-clients", "-F", "#{session_id}\t#{client_tty}")
        inside, ttys = {session.key}, set[str]()
        while True:
            ttys = {pane for key, pane in panes if key in inside and pane}
            shown = {key for key, client in clients if client in ttys} - inside
            if not shown:
                return tty in ttys
            inside |= shown

    def _listed(self, *args: str) -> list[tuple[str, str]]:
        """The pairs that a listing of tmux prints, one per line; none without a server."""
        result = self._client(*args)
        if result.returncode != 0:
            if not self.running():
                return []
            raise self._failed(args, result)
        return [
            (key, value)
            for line in result.stdout.split("\n")  # not splitlines(), which also splits at \r
            if line
            for key, _, value in [line.partition("\t")]
        ]

    def attach_command(self, session: Session) -> list[str]:
        """Plain `tmux attach-session`, by the ID of the session: tmux, as the user knows it."""
        return [self.binary, *self._options(), "attach-session", "-t", session.key]

    def kill(self, name: str, *, force: bool = False) -> None:
        """Ends a session; see `Keeper.kill`.

        With `force`, its scope and the processes in the session of its pane get SIGKILL first, as
        far as tmux still names its process: e.g. those a command left running when it ended.
        """
        self.check()
        session = self.session(name)
        if force:
            self._kill_hard(session)
        result = self._client("kill-session", "-t", session.key)
        if result.returncode != 0:
            if session.key in self._keys():
                raise self._failed(["kill-session"], result)
            if not force:  # ended meanwhile
                raise NoSuchSessionError(f"no terminal named {name}")
            # With `force`: gone with its processes, as it should.

    def _kill_hard(self, session: Session) -> None:
        """SIGKILL for the processes of a session: in its scope, and in the session of its pane.

        Its scope is the one its process runs in: ours, or the one tmux makes, see `create`. Never
        the scope of the server, which holds a session started by hand on a tmux that makes none.
        """
        if session.pid is None:
            return
        unit = scope_of(session.pid) if self.scopes else None
        if unit is not None and unit != scope_of(self._server_pid()):
            systemctl = shutil.which("systemctl") or "systemctl"
            subprocess.run(  # noqa: S603 - arguments are a list, never passed through a shell
                [systemctl, "--user", "kill", "--signal=SIGKILL", unit],
                capture_output=True,
                check=False,
                timeout=self.timeout,
            )
        # The process of the pane leads its session (tmux calls setsid), whose members its
        # children are.
        pkill = shutil.which("pkill") or "pkill"
        subprocess.run(  # noqa: S603 - arguments are a list, never passed through a shell
            [pkill, "-KILL", "-s", str(session.pid)],
            capture_output=True,
            check=False,
            timeout=self.timeout,
        )

    def _server_pid(self) -> int | None:
        """The process of the server; None if it does not say."""
        result = self._client("display-message", "-p", "#{pid}")
        text = result.stdout.strip()
        return int(text) if result.returncode == 0 and text.isdecimal() else None
