"""The Daemon's systemd user unit: written by `daemon install`, run and stopped through systemd.

The unit runs the hephaistos that installed it, by the path it was run as: a link such as
`~/.local/bin/hephaistos` stays valid when the tool is reinstalled behind it. It carries the
variables that choose our directories, as systemd doesn't see the shell's.
"""

import getpass
import os
import shlex
import signal
import subprocess
import time
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from hephaistos.core import config
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.paths import HOME_VARIABLE, Paths
from hephaistos.daemon import status

UNIT_NAME = "hephaistos.service"
MARKER = "# Written by `hephaistos daemon install`, which rewrites it; `uninstall` removes it."
# Variables that choose where our config, database and logs are.
PATH_VARIABLES = (HOME_VARIABLE, "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME")
LINGER_DIR = Path("/var/lib/systemd/linger")  # a file per user with linger on
TIMEOUT = 30.0  # seconds a systemctl or loginctl call may take
START_WAIT = 10.0  # seconds a started Daemon gets to take its lock
STOP_WAIT = 10.0  # seconds a Daemon not under systemd gets to stop
POLL = 0.05  # seconds between looking again
NOT_AVAILABLE = (
    "systemd user services aren't available here; run `hephaistos daemon run`, e.g. in tmux"
)


class SystemdError(HephaistosError):
    """systemd isn't available, or refused what we asked."""


class ForeignUnitError(HephaistosError):
    """A unit with our name exists that we didn't write."""


@dataclass(frozen=True)
class UnitState:
    """What systemd says about our unit."""

    installed: bool
    enabled: bool
    active: str  # `active`, `inactive`, `failed`, `activating`, …
    exit_code: int | None  # of the last run, if it ended


@dataclass(frozen=True)
class Installed:
    """What `install` did."""

    created: bool  # there was no unit before
    removed: list[str]  # lines of the unit that changed, as they were
    added: list[str]  # as they are now
    restarted: bool


def unit_file() -> Path:
    """Where systemd looks for our unit, whatever this shell's XDG_CONFIG_HOME says."""
    return Path.home() / ".config" / "systemd" / "user" / UNIT_NAME


def _quoted(value: str) -> str:
    """A value as one word for systemd, `%` escaped as it would be a specifier."""
    escaped = value.replace("\\", "\\\\").replace('"', '\\"').replace("%", "%%")
    return f'"{escaped}"'


def _unquoted(words: str) -> list[str]:
    """The words of a unit's value, as `_quoted` wrote them."""
    return [word.replace("%%", "%") for word in shlex.split(words)]


def unit_text(executable: Path, env: Mapping[str, str]) -> str:
    """The unit that runs `executable daemon run` with the path variables set in `env`."""
    variables = [
        f"Environment={_quoted(f'{name}={env[name]}')}" for name in PATH_VARIABLES if env.get(name)
    ]
    return "\n".join(
        [
            MARKER,
            "[Unit]",
            "Description=hephaistos Daemon: observes this Machine in the background",
            "",
            "[Service]",
            f"ExecStart={_quoted(str(executable))} daemon run",
            *variables,
            "Restart=on-failure",
            "RestartSec=5",
            "RestartPreventExitStatus=78",  # EX_CONFIG: it can't start, and retrying won't help
            "",
            "[Install]",
            "WantedBy=default.target",
            "",
        ]
    )


def installed_text() -> str | None:
    """Our unit as installed; None if there is none. Raises ForeignUnitError for another's."""
    try:
        text = unit_file().read_text()
    except FileNotFoundError:
        return None
    if not text.startswith(MARKER):
        raise ForeignUnitError(f"{unit_file()} wasn't written by hephaistos; leaving it alone")
    return text


def _values(text: str, key: str) -> list[list[str]]:
    """The words of each `key=` line of a unit."""
    prefix = f"{key}="
    return [_unquoted(line[len(prefix) :]) for line in text.splitlines() if line.startswith(prefix)]


def installed_executable(text: str) -> Path | None:
    """The hephaistos that an installed unit runs."""
    commands = _values(text, "ExecStart")
    return Path(commands[0][0]) if commands and commands[0] else None


def installed_variables(text: str) -> dict[str, str]:
    """The variables an installed unit sets."""
    pairs = (words[0].partition("=") for words in _values(text, "Environment") if words)
    return {name: value for name, _, value in pairs}


def path_differences(text: str, env: Mapping[str, str]) -> list[str]:
    """Where an installed unit's path variables differ from `env`'s, e.g. this shell's."""
    unit = installed_variables(text)
    return [
        f"{name}: the Daemon has {unit.get(name) or 'none'}, this shell {env.get(name) or 'none'}"
        for name in PATH_VARIABLES
        if (unit.get(name) or "") != (env.get(name) or "")
    ]


def settings_variables(env: Mapping[str, str]) -> list[str]:
    """The settings variables set in `env`, which the Daemon under systemd doesn't see."""
    return [name for key in config.KEYS if env.get(name := config.variable(key))]


def _run(*command: str) -> subprocess.CompletedProcess[str]:
    """Runs systemctl or loginctl; raises SystemdError if it can't run."""
    try:
        return subprocess.run(  # noqa: S603 - arguments are a list, never passed through a shell
            command, capture_output=True, text=True, check=False, timeout=TIMEOUT
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise SystemdError(f"{command[0]} failed: {error}") from None


def _systemctl(*args: str) -> str:
    """Runs `systemctl --user`; returns its output; raises SystemdError if it fails."""
    result = _run("systemctl", "--user", *args)
    if result.returncode != 0:
        detail = result.stderr.strip() or f"exit code {result.returncode}"
        raise SystemdError(f"systemctl --user {' '.join(args)} failed: {detail}")
    return result.stdout


def is_available() -> bool:
    """Whether systemd runs user services for us here."""
    try:
        return _run("systemctl", "--user", "show-environment").returncode == 0
    except SystemdError:
        return False


def _require_systemd() -> None:
    """Raises SystemdError if systemd user services aren't available."""
    if not is_available():
        raise SystemdError(NOT_AVAILABLE)


def unit_state() -> UnitState | None:
    """What systemd says about our unit; None if systemd isn't available."""
    if not is_available():
        return None
    properties = "LoadState,UnitFileState,ActiveState,ExecMainStatus"
    lines = _systemctl("show", UNIT_NAME, f"--property={properties}").splitlines()
    values: dict[str, str] = {}
    for line in lines:
        key, _, value = line.partition("=")
        values[key] = value
    active = values.get("ActiveState", "")
    code = values.get("ExecMainStatus", "")
    return UnitState(
        installed=values.get("LoadState") == "loaded",
        enabled=values.get("UnitFileState") == "enabled",
        active=active,
        exit_code=int(code) if code.isdigit() and active != "active" else None,
    )


def has_linger() -> bool:
    """Whether systemd starts this user's services at boot and keeps them after logout."""
    return (LINGER_DIR / getpass.getuser()).exists()


def enable_linger() -> None:
    """Has systemd start this user's services at boot and keep them after logout."""
    result = _run("loginctl", "enable-linger")
    if result.returncode != 0:
        detail = result.stderr.strip() or f"exit code {result.returncode}"
        raise SystemdError(f"loginctl enable-linger failed: {detail}")


def _changed_lines(old: str, new: str) -> tuple[list[str], list[str]]:
    """The lines only in `old`, and those only in `new`."""
    before, after = old.splitlines(), new.splitlines()
    return [line for line in before if line not in after], [
        line for line in after if line not in before
    ]


def install(executable: Path, env: Mapping[str, str]) -> Installed:
    """Writes our unit if it changed, enables and starts it; restarts it if it ran changed."""
    _require_systemd()
    new = unit_text(executable, env)
    old = installed_text()
    restarted = False
    if old != new:
        path = unit_file()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(new)
        _systemctl("daemon-reload")
        state = unit_state()
        if old is not None and state is not None and state.active == "active":
            _systemctl("restart", UNIT_NAME)
            restarted = True
    _systemctl("enable", "--now", UNIT_NAME)
    removed, added = _changed_lines(old or "", new) if old is not None else ([], [])
    return Installed(old is None, removed, added, restarted)


def uninstall() -> bool:
    """Disables and stops our unit, and deletes it; returns whether there was one."""
    _require_systemd()
    if installed_text() is None:
        return False
    _systemctl("disable", "--now", UNIT_NAME)
    unit_file().unlink()
    _systemctl("daemon-reload")
    return True


def _running_pid(directory: Path) -> int | None:
    """The pid of the Daemon running now, as its status file says; None if none runs."""
    if not status.is_running(directory):
        return None
    found = status.read(directory)
    return found.pid if found is not None and found.stopped_at is None else None


def _refuse_daemon_without_systemd(paths: Paths) -> None:
    """Raises if a Daemon runs that systemd didn't start, which systemd couldn't stop."""
    state = unit_state()
    if state is None:
        raise SystemdError(NOT_AVAILABLE)
    if state.active != "active" and status.is_running(paths.state_dir):
        pid = _running_pid(paths.state_dir)
        running = f"a Daemon is already running (pid {pid})" if pid else "a Daemon is running"
        raise SystemdError(
            f"{running}, not under systemd; stop it first with `hephaistos daemon stop`"
        )


def wait_started(paths: Paths, previous: int | None = None) -> int:
    """The pid of the Daemon that systemd started after `previous`, once it holds its lock."""
    deadline = time.monotonic() + START_WAIT
    while time.monotonic() < deadline:
        pid = _running_pid(paths.state_dir)
        if pid is not None and pid != previous:
            return pid
        state = unit_state()
        if state is not None and state.active in {"failed", "inactive"}:
            code = f" (exit code {state.exit_code})" if state.exit_code else ""
            raise SystemdError(
                f"the Daemon didn't start{code}; see `hephaistos log show --process daemon`"
            )
        time.sleep(POLL)
    raise SystemdError(f"the Daemon didn't start within {START_WAIT:g} s")


def _require_installed(env: Mapping[str, str]) -> None:
    """Raises if our unit isn't installed, or for other directories than `env` names.

    Such a Daemon would keep other data, e.g. the real one for a shell with a scratch home.
    """
    text = installed_text()
    if text is None:
        raise SystemdError(
            "the Daemon isn't installed; run `hephaistos daemon install`,"
            " or `hephaistos daemon run` for this session"
        )
    if differences := path_differences(text, env):
        raise SystemdError(
            f"the installed Daemon keeps its data elsewhere ({'; '.join(differences)});"
            " `hephaistos daemon install` installs this shell's instead"
        )


def start(paths: Paths, env: Mapping[str, str] = os.environ) -> int:
    """Starts the Daemon through systemd; returns its pid."""
    _refuse_daemon_without_systemd(paths)
    _require_installed(env)
    running = _running_pid(paths.state_dir)
    if running is not None:
        return running
    _systemctl("start", UNIT_NAME)
    return wait_started(paths)


def restart(paths: Paths, env: Mapping[str, str] = os.environ) -> int:
    """Restarts the Daemon through systemd, or starts it; returns its new pid."""
    _refuse_daemon_without_systemd(paths)
    _require_installed(env)
    previous = _running_pid(paths.state_dir)
    _systemctl("restart", UNIT_NAME)
    return wait_started(paths, previous)


def stop(paths: Paths) -> int | None:
    """Stops the Daemon, through systemd if it runs under it; returns its pid if one ran."""
    pid = _running_pid(paths.state_dir)
    state = unit_state()
    if state is not None and state.active in {"active", "activating"}:
        _systemctl("stop", UNIT_NAME)
        return pid
    if not status.is_running(paths.state_dir):
        return None
    if pid is None:
        raise HephaistosError("a Daemon is running, but its status file doesn't say which")
    os.kill(pid, signal.SIGTERM)
    deadline = time.monotonic() + STOP_WAIT
    while status.is_running(paths.state_dir):
        if time.monotonic() >= deadline:
            raise HephaistosError(f"the Daemon (pid {pid}) is still running after {STOP_WAIT:g} s")
        time.sleep(POLL)
    return pid
