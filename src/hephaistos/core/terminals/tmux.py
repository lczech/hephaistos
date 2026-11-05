"""tmux as the Keeper: one session with one pane per Terminal, on a socket of our own.

Every call runs the tmux client with our socket (`-L`) and our generated config (`-f`), so the
user's own tmux and `~/.tmux.conf` never come into it. Where systemd's user manager answers,
the server starts in a scope of its own, with that manager's environment, and each Terminal's
process in another one; see `scopes`.
"""

import dataclasses
import hashlib
import logging
import os
import pwd
import re
import shutil
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
    KeeperError,
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
TIMEOUT = 10.0  # seconds for one tmux command; tmux is local, so only a hung one takes long
DEFAULT_SOCKET = "hephaistos"
CONFIG_NAME = "tmux.conf"  # in the state directory

#: Our session option holding the Terminal's ID, and our server option holding the config's.
ID_OPTION = "@hephaistos_id"
CONFIG_OPTION = "@hephaistos_config"

#: What a terminal emulator passes on to a new tab: tmux's `update-environment` defaults, with
#: Wayland's display and the session's D-Bus. A new Terminal takes them from its creator.
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
    f"#{{{CONFIG_OPTION}}}",
)
_SEPARATOR = "\t\x1f\t"
_END = "\x1e\n"
_FORMAT = _SEPARATOR.join(_FIELDS) + _END.rstrip("\n")
_ESCAPED = {"\t\\037\t": _SEPARATOR, "\\036\n": _END}  # as newer tmux prints them

#: How tmux says that no server runs on the socket, that its socket is stale, or that it quit
#: while answering, e.g. as its last session ended.
_NO_SERVER = re.compile(
    r"^(no server running on |error connecting to |server exited unexpectedly)", re.MULTILINE
)
_NO_SESSION = re.compile(r"^(can't find session|no such session)", re.MULTILINE)
_DUPLICATE = re.compile(r"^duplicate session", re.MULTILINE)


def parse_version(text: str) -> tuple[int, int] | None:
    """The version that `tmux -V` names, e.g. `tmux 3.2a` → (3, 2); `next-3.6` counts as 3.6.

    None if it names none, e.g. `tmux master` or OpenBSD's `tmux openbsd-7.5`.
    """
    match = re.fullmatch(r"tmux (?:next-)?(\d+)\.(\d+)[a-z]?_?", text.strip())
    return (int(match[1]), int(match[2])) if match else None


def socket_name(setting: str, env: Mapping[str, str] = os.environ) -> str:
    """The socket's name for the setting `terminals.tmux.socket`.

    `auto` gives `hephaistos`, or with HEPHAISTOS_HOME, a name of that directory's own, so that
    tests and scratch Daemons keep apart from the real Terminals.
    """
    if setting != "auto":
        return setting
    home = env.get(HOME_VARIABLE)
    if not home:
        return DEFAULT_SOCKET
    digest = hashlib.sha256(os.fsencode(Path(home).resolve())).hexdigest()
    return f"{DEFAULT_SOCKET}-{digest[:10]}"


def config_text(history: int) -> str:
    """Our tmux config, ending with the marker that names it by its hash.

    A plain terminal: no status bar, and none of tmux's keys but detaching and copy mode.
    """
    variables = " ".join(UPDATED_VARIABLES)
    body = f"""\
# hephaistos's tmux config, generated from its settings: changes here are overwritten.
set -g status off
set -g default-terminal xterm-256color
set -as terminal-features ",*:RGB"
set-environment -g COLORTERM truecolor
set -g extended-keys on
set -g focus-events on
set -s escape-time 10
set -g history-limit {history}
set -g update-environment "{variables}"
unbind -a -T prefix
bind -T prefix d detach-client
bind -T prefix [ copy-mode
bind -T prefix PageUp copy-mode -u
bind -T prefix C-b send-prefix
"""
    digest = hashlib.sha256(body.encode()).hexdigest()[:12]
    return f"{body}set -g {CONFIG_OPTION} {digest}\n"


def config_digest(text: str) -> str:
    """The hash that `text`'s marker names."""
    return text.rstrip("\n").rsplit(" ", 1)[-1]


def _escaped(argument: str) -> str:
    """An argument as tmux reads it literally: one ending in `;` would end a command."""
    return f"{argument[:-1]}\\;" if argument.endswith(";") else argument


def _login_shell(environment: Mapping[str, str]) -> str:
    """The user's shell: the creator's SHELL, else the account's."""
    return environment.get("SHELL") or pwd.getpwuid(os.getuid()).pw_shell or "/bin/sh"


def _time(text: str) -> datetime:
    return datetime.fromtimestamp(int(text), UTC)


class TmuxKeeper:
    """Keeps Terminals alive in tmux; see the module's description."""

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
        self.config = config_text(history)
        self.timeout = timeout
        self._detect_scopes = detect_scopes
        self._checked = False

    @classmethod
    def from_settings(cls, paths: Paths, env: Mapping[str, str] = os.environ) -> "TmuxKeeper":
        """The Keeper as this Machine's settings describe it."""
        settings = config.settings().terminals
        return cls(
            binary=shutil.which(settings.tmux.path) or settings.tmux.path,
            socket=socket_name(settings.tmux.socket, env),
            config_file=paths.state_dir / CONFIG_NAME,
            history=settings.history,
        )

    @cached_property
    def scopes(self) -> Scopes | None:
        """The user's systemd manager, asked once, when first needed."""
        return self._detect_scopes()

    # Running tmux.

    def _client(
        self, *args: str, env: Mapping[str, str] | None = None, scoped: bool = False
    ) -> subprocess.CompletedProcess[str]:
        """Runs a tmux command on our socket; `scoped`, in a scope with systemd's environment."""
        command = [self.binary, "-L", self.socket, "-f", str(self.config_file), *args]
        if scoped and self.scopes:
            command = self.scopes.command(command, unit=None, description="hephaistos tmux server")
            # The socket's directory is the caller's, whatever the manager's environment says.
            keep = {name: os.environ[name] for name in ("TMUX_TMPDIR",) if name in os.environ}
            env = {**self.scopes.environment, **keep}
        try:
            return subprocess.run(  # noqa: S603 - arguments are a list, never passed through a shell
                command,
                capture_output=True,
                text=True,
                errors="surrogateescape",  # paths are bytes; they survive the round trip
                check=False,
                timeout=self.timeout,
                env=env,
            )
        except FileNotFoundError:
            raise KeeperError(self._missing_text()) from None
        except subprocess.TimeoutExpired:
            raise KeeperError(f"tmux didn't answer within {self.timeout:g} s") from None
        except OSError as error:
            raise KeeperError(f"tmux failed: {error}") from None

    def _failed(self, args: Sequence[str], result: subprocess.CompletedProcess[str]) -> KeeperError:
        """The error for a failed tmux command."""
        detail = result.stderr.strip() or f"exit code {result.returncode}"
        return KeeperError(f"tmux {args[0]} failed: {detail}")

    def _missing_text(self) -> str:
        return (
            f"tmux isn't installed ({self.binary} not found); install tmux {MINIMUM_TEXT} or"
            " later, or set terminals.tmux.path to one"
        )

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
        try:
            result = subprocess.run(  # noqa: S603 - arguments are a list, never passed through a shell
                [self.binary, "-V"],
                capture_output=True,
                text=True,
                check=False,
                timeout=self.timeout,
            )
        except FileNotFoundError:
            raise KeeperError(self._missing_text()) from None
        except (OSError, subprocess.SubprocessError) as error:
            raise KeeperError(f"tmux failed: {error}") from None
        version = parse_version(result.stdout)
        if version is None:
            log.warning("unknown tmux version %r: taken as new enough", result.stdout.strip())
        elif version < MINIMUM:
            raise KeeperError(
                f"{result.stdout.strip()} is too old: Terminals need tmux {MINIMUM_TEXT} or later;"
                " install a newer one, e.g. without root, and set terminals.tmux.path to it"
            )
        self._write_config()
        self._checked = True

    # Sessions.

    def _parsed(self, record: str) -> tuple[Session, str] | None:
        """A pane's session and the config marker its server has; None, logged, if malformed."""
        fields = record.split(_SEPARATOR)
        if len(fields) != len(_FIELDS):
            log.warning("skipped a tmux session we can't read: %r", record[:200])
            return None
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
            marker,
        ) = fields
        try:
            parsed_id = uuid.UUID(terminal_id) if terminal_id else None
        except ValueError:
            log.warning("tmux session %s has an ID that isn't one: %r", name, terminal_id)
            parsed_id = None
        try:
            session = Session(
                key=key,
                terminal_id=parsed_id,
                name=name,
                directory=Path(directory),
                current_directory=Path(current) if current else None,
                program=program,
                pid=int(pid),
                clients=int(clients),
                created_at=_time(created),
                active_at=_time(active),
                panes=1,
            )
        except ValueError:
            log.warning("skipped a tmux session we can't read: %r", record[:200])
            return None
        return session, marker

    def sessions(self) -> list[Session]:
        """All sessions, each as its first pane, with the number of its panes."""
        self.check()
        result = self._client("list-panes", "-a", "-F", _FORMAT)
        if result.returncode != 0:
            if _NO_SERVER.search(result.stderr):
                return []
            raise self._failed(["list-panes"], result)
        found: dict[str, Session] = {}
        markers: set[str] = set()
        output = result.stdout
        for escaped, raw in _ESCAPED.items():
            output = output.replace(escaped, raw)
        for record in output.split(_END):
            if not record or (parsed := self._parsed(record)) is None:
                continue
            session, marker = parsed
            markers.add(marker)
            if (first := found.get(session.key)) is None:
                found[session.key] = session
            else:  # a later pane of a session split outside hephaistos: counted only
                found[session.key] = dataclasses.replace(first, panes=first.panes + 1)
        if markers - {config_digest(self.config)}:
            self._load_config()
        return list(found.values())

    def _load_config(self) -> None:
        """Loads our config into a running server that lacks it, e.g. one started by hand."""
        log.info("loading our tmux config into the server on socket %s", self.socket)
        result = self._client("source-file", str(self.config_file))
        if result.returncode != 0 and not _NO_SERVER.search(result.stderr):
            raise self._failed(["source-file"], result)

    def running(self) -> bool:
        """Whether a server runs on our socket."""
        result = self._client("list-sessions", "-F", "#{session_id}")
        return result.returncode == 0

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

        Its ID is set by the same command list, so nobody sees it without one.
        """
        self.check()
        variables = {name: environment[name] for name in UPDATED_VARIABLES if name in environment}
        variables[TERMINAL_VARIABLE] = str(terminal_id)
        pairs = [arg for item, value in variables.items() for arg in ("-e", f"{item}={value}")]
        program = list(command) if command else [_login_shell(environment), "-l"]
        if self.scopes:
            program = self.scopes.command(
                program,
                unit=f"hephaistos-terminal-{terminal_id}",
                description=f"hephaistos terminal {name}",
            )
        args = [
            "new-session", "-d", "-s", name, "-c", str(directory), *pairs,
            *map(_escaped, program),
            ";", "set-option", ID_OPTION, str(terminal_id),  # without a target: the new session
        ]  # fmt: skip
        result = self._client(*args, scoped=not self.running())
        if result.returncode != 0:
            if _DUPLICATE.search(result.stderr):
                raise NameTakenError(f"a terminal named {name} exists already")
            raise self._failed(args, result)
        return self.session(name)

    def adopt(self, name: str, terminal_id: uuid.UUID) -> None:
        """Gives a session found without an ID this one."""
        self.check()
        result = self._client("set-option", "-t", f"={name}:", ID_OPTION, str(terminal_id))
        if result.returncode != 0:
            raise self._not_found(name, result) or self._failed(["set-option"], result)

    def rename(self, name: str, new_name: str) -> None:
        """Renames a session; see `Keeper.rename`."""
        self.check()
        result = self._client("rename-session", "-t", f"={name}", new_name)
        if result.returncode != 0:
            if _DUPLICATE.search(result.stderr):
                raise NameTakenError(f"a terminal named {new_name} exists already")
            raise self._not_found(name, result) or self._failed(["rename-session"], result)

    def kill(self, name: str, *, force: bool = False) -> None:
        """Ends a session; see `Keeper.kill`.

        With `force`, its scope and the processes in its pane's session get SIGKILL first.
        """
        self.check()
        if force:
            session = self.session(name)
            self._kill_hard(session)
        result = self._client("kill-session", "-t", f"={name}")
        if result.returncode != 0:
            if force and (_NO_SESSION.search(result.stderr) or _NO_SERVER.search(result.stderr)):
                return  # gone with its processes, as it should
            raise self._not_found(name, result) or self._failed(["kill-session"], result)

    def _kill_hard(self, session: Session) -> None:
        """SIGKILL for a session's processes: its scope's, and those in its pane's session."""
        if self.scopes and session.terminal_id:
            systemctl = shutil.which("systemctl") or "systemctl"
            unit = f"hephaistos-terminal-{session.terminal_id}.scope"
            subprocess.run(  # noqa: S603 - arguments are a list, never passed through a shell
                [systemctl, "--user", "kill", "--signal=SIGKILL", unit],
                capture_output=True,
                check=False,
                timeout=self.timeout,
            )
        # The pane's process leads its session (tmux calls setsid), whose members its children are.
        pkill = shutil.which("pkill") or "pkill"
        subprocess.run(  # noqa: S603 - arguments are a list, never passed through a shell
            [pkill, "-KILL", "-s", str(session.pid)],
            capture_output=True,
            check=False,
            timeout=self.timeout,
        )

    def _not_found(
        self, name: str, result: subprocess.CompletedProcess[str]
    ) -> NoSuchSessionError | None:
        """NoSuchSessionError if tmux found no such session, or no server at all."""
        if _NO_SESSION.search(result.stderr) or _NO_SERVER.search(result.stderr):
            return NoSuchSessionError(f"no terminal named {name}")
        return None
