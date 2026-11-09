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

#: Our options: on a session, the ID of its Terminal; on the server, the config marker.
ID_OPTION = "@hephaistos_id"
CONFIG_OPTION = "@hephaistos_config"

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
#: How tmux says that a server has no sessions left, e.g. to `list-panes -a`.
_NO_SESSIONS = re.compile(r"^no current target", re.MULTILINE)
#: What tmux itself prints, its apostrophe written as `\x27` (docs/style.md: none in our text).
_NO_SESSION = re.compile(r"^(can\x27t find session|no such session)", re.MULTILINE)
_DUPLICATE = re.compile(r"^duplicate session", re.MULTILINE)


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


def binary() -> str:
    """The tmux to run: `terminals.tmux.path`, found on the PATH unless it is a path."""
    path = config.settings().terminals.tmux.path
    return shutil.which(path) or path


def missing_text(binary: str) -> str:
    """Why there are no Terminals without tmux, and what to do."""
    return (
        f"tmux is not installed ({binary} not found); install tmux {MINIMUM_TEXT} or later,"
        " or set terminals.tmux.path to one"
    )


def installation(binary: str, timeout: float = TIMEOUT) -> Installation:
    """The tmux that `binary` runs; raises KeeperError if it is not there or fails."""
    try:
        result = subprocess.run(  # noqa: S603 - arguments are a list, never passed through a shell
            [binary, "-V"], capture_output=True, text=True, check=False, timeout=timeout
        )
    except FileNotFoundError:
        raise KeeperError(missing_text(binary)) from None
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


def config_text(history: int) -> str:
    """Our tmux config, ending with the marker that names it by its hash.

    A plain terminal: no status bar, and none of the tmux keys but detaching and copy mode. The
    server outlives its last session, so that no server means it crashed or was killed.
    """
    variables = " ".join(UPDATED_VARIABLES)
    body = f"""\
# The tmux config of hephaistos, generated from its settings: changes here are overwritten.
set -g status off
set -g default-terminal xterm-256color
set -as terminal-features ",*:RGB"
set-environment -g COLORTERM truecolor
set -g extended-keys on
set -g focus-events on
set -s escape-time 10
set -s exit-empty off
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
    """The hash that the marker in `text` names."""
    return text.rstrip("\n").rsplit(" ", 1)[-1]


def _literal(text: str) -> str:
    """Text tmux expands as a format, e.g. the name or directory of a new session, kept as it is."""
    return _escaped(text.replace("#", "##"))


def _escaped(argument: str) -> str:
    """An argument as tmux reads it literally: one ending in `;` would end a command there.

    Every argument holding a name, a path or a value goes through it.
    """
    return f"{argument[:-1]}\\;" if argument.endswith(";") else argument


def _login_shell(environment: Mapping[str, str]) -> str:
    """The shell of the user: SHELL in the environment of the creator, else that of the account."""
    return environment.get("SHELL") or pwd.getpwuid(os.getuid()).pw_shell or "/bin/sh"


#: Sessions without a name already logged, by socket and ID: once is enough, not each pass.
_UNNAMED: set[tuple[str, str]] = set()


def _time(text: str) -> datetime:
    return datetime.fromtimestamp(int(text), UTC)


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
        self.config = config_text(history)
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

    def _client(
        self, *args: str, env: Mapping[str, str] | None = None, scoped: bool = False
    ) -> subprocess.CompletedProcess[str]:
        """Runs a tmux command on our socket; `scoped`, in a scope, with the systemd environment."""
        # -u: UTF-8 whatever the locale, else tmux prints `_` for each other character.
        command = [self.binary, "-u", "-L", self.socket, "-f", str(self.config_file), *args]
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
            raise KeeperError(missing_text(self.binary)) from None
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
        self._write_config()
        self._checked = True

    # Sessions.

    def _parsed(self, record: str) -> tuple[Session, str] | None:
        """The session of a pane and the config marker its server has.

        None, logged, if malformed.
        """
        fields = record.split(_SEPARATOR)
        if len(fields) != len(_FIELDS):
            log.warning("skipped a tmux session we cannot read: %r", record[:200])
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
        if not name:  # e.g. one made by hand as `#`, which tmux 3.8 expands to nothing
            if (self.socket, key) not in _UNNAMED:
                _UNNAMED.add((self.socket, key))
                log.warning("left tmux session %s alone: it has no name; rename it to see it", key)
            return None
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
                program=program,
                pid=int(pid),
                clients=int(clients),
                created_at=_time(created),
                active_at=_time(active),
                panes=1,
            )
        except ValueError:
            log.warning("skipped a tmux session we cannot read: %r", record[:200])
            return None
        return session, marker

    def sessions(self) -> list[Session]:
        """All sessions, each as its first pane, with the number of its panes."""
        self.check()
        result = self._client("list-panes", "-a", "-F", _FORMAT)
        if result.returncode != 0:
            if _NO_SERVER.search(result.stderr) or _NO_SESSIONS.search(result.stderr):
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
        result = self._client("source-file", _escaped(str(self.config_file)))
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

        Its ID is set by the same command list, so nobody sees it without one. With systemd, its
        process runs in a scope of its own, `hephaistos-terminal-<id>.scope`. A tmux built with
        systemd support, e.g. that of Ubuntu, moves each new pane into its own `tmux-spawn-*.scope`
        too, from the server, while the pane starts: whichever move comes last holds it, as
        isolated either way.
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
            "new-session", "-d", "-s", _literal(name), "-c", _literal(str(directory)),
            *map(_escaped, pairs),
            *map(_escaped, program),
            ";", "set-option", ID_OPTION, str(terminal_id),  # without a target: the new session
        ]  # fmt: skip
        result = self._client(*args, scoped=not self.running())
        if result.returncode != 0:
            if _DUPLICATE.search(result.stderr):
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
            if self._not_found(session.name, result):
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
            if _DUPLICATE.search(result.stderr):
                raise NameTakenError(f"a terminal named {new_name} exists already")
            raise self._not_found(name, result) or self._failed(["rename-session"], result)

    def kill(self, name: str, *, force: bool = False) -> None:
        """Ends a session; see `Keeper.kill`.

        With `force`, its scope and the processes in the session of its pane get SIGKILL first.
        """
        self.check()
        session = self.session(name)
        if force:
            self._kill_hard(session)
        result = self._client("kill-session", "-t", session.key)
        if result.returncode != 0:
            if force and self._not_found(name, result):
                return  # gone with its processes, as it should
            raise self._not_found(name, result) or self._failed(["kill-session"], result)

    def _kill_hard(self, session: Session) -> None:
        """SIGKILL for the processes of a session: in its scope, and in the session of its pane.

        Its scope is the one its process runs in: ours, or the one tmux makes, see `create`. Never
        the scope of the server, which holds a session started by hand on a tmux that makes none.
        """
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

    def _not_found(
        self, name: str, result: subprocess.CompletedProcess[str]
    ) -> NoSuchSessionError | None:
        """NoSuchSessionError if tmux found no such session, or no server at all."""
        if any(
            pattern.search(result.stderr) for pattern in (_NO_SESSION, _NO_SESSIONS, _NO_SERVER)
        ):
            return NoSuchSessionError(f"no terminal named {name}")
        return None
