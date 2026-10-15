"""Starting the Desktop: Electron from the checkout, as the app that `gui/package.json` names."""

import os
import time
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.paths import Paths, private_directory, shell_path
from hephaistos.daemon.server.token import token_file

PACKAGE = Path("gui")  # the GUI's npm package, in the checkout: also Electron's app
ELECTRON = PACKAGE / "node_modules" / "electron" / "dist" / "electron"
MAIN = PACKAGE / "desktop" / "dist" / "main.js"
NPM = f"uv run npm --prefix {PACKAGE}"
SETSID = "setsid"  # util-linux  # uv finds our Node only in the checkout

# What the Desktop's main process is told (`gui/desktop/src/main.ts`).
EXECUTABLE_VARIABLE = "HEPHAISTOS_EXECUTABLE"  # the hephaistos to ask for links and starts
PROFILE_VARIABLE = "HEPHAISTOS_DESKTOP_PROFILE"  # Chromium's profile: storage, the saved Layout
TOKEN_VARIABLE = "HEPHAISTOS_TOKEN_FILE"  # noqa: S105 - a name; watched, to follow a renewed token
AS_NODE_VARIABLE = "ELECTRON_RUN_AS_NODE"  # set by editors built on Electron, e.g. VS Code

LOG_NAME = "desktop.log"  # Electron's output, for when it fails
LOG_LIMIT = 1_000_000  # bytes, beyond which it starts anew
STARTUP = 2.0  # seconds a started Electron gets to fail, e.g. without its sandbox
POLL = 0.1


class DesktopError(HephaistosError):
    """The Desktop can't start."""


@dataclass(frozen=True)
class Desktop:
    """The Desktop in a checkout."""

    checkout: Path

    @property
    def electron(self) -> Path:
        """Electron's binary, which npm downloads into the checkout."""
        return self.checkout / ELECTRON


def located(checkout: Path | None) -> Desktop:
    """The Desktop in the checkout hephaistos runs from, built or not; raises without one."""
    if checkout is None:
        raise DesktopError("this hephaistos doesn't run from a checkout, so it has no Desktop yet")
    return Desktop(checkout)


def find(checkout: Path | None) -> Desktop:
    """The Desktop in the checkout hephaistos runs from; raises, saying how to make it."""
    desktop = located(checkout)
    where = f"cd {shell_path(desktop.checkout)} && "
    if not desktop.electron.is_file():
        raise DesktopError(
            f"Electron isn't installed: `{where}{NPM} ci && {NPM} run fetch-electron`"
        )
    if not (desktop.checkout / MAIN).is_file():
        raise DesktopError(f"the Desktop isn't built: `{where}{NPM} run build`")
    return desktop


def environment(env: Mapping[str, str], paths: Paths, executable: Path) -> dict[str, str]:
    """The Desktop's environment: this one, plus what its main process needs to know."""
    kept = {name: value for name, value in env.items() if name != AS_NODE_VARIABLE}
    return kept | {
        EXECUTABLE_VARIABLE: str(executable),
        PROFILE_VARIABLE: str(private_directory(paths.state_dir / "desktop")),
        TOKEN_VARIABLE: str(token_file(paths)),
    }


def _log(paths: Paths) -> Path:
    """Where Electron's output goes; a long one starts anew, the running Desktop keeps its own."""
    log = private_directory(paths.state_dir) / LOG_NAME
    if log.is_file() and log.stat().st_size > LOG_LIMIT:
        log.unlink()
    return log


def _ending(log: Path, lines: int = 5) -> str:
    """The last lines of the log, to show why Electron ended."""
    try:
        text = log.read_text(errors="replace").strip()
    except OSError:
        return ""
    return "\n".join(text.splitlines()[-lines:])


def open_desktop(
    desktop: Desktop, paths: Paths, executable: Path, env: Mapping[str, str]
) -> int | None:
    """Starts the Desktop, apart from this process; returns its pid.

    Returns None if a Desktop was open already, which comes to the front instead.
    Raises DesktopError if Electron ends with an error within STARTUP seconds.
    """
    log = _log(paths)
    output = os.open(log, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
    try:
        # In a session of its own, it outlives this command and its terminal. Through the
        # setsid command, as some Python builds lack posix_spawn's setsid; not leading a
        # process group, the spawned process becomes Electron, keeping its pid.
        pid = os.posix_spawnp(
            SETSID,
            [SETSID, str(desktop.electron), str(desktop.checkout / PACKAGE)],
            environment(env, paths, executable),
            file_actions=[
                (os.POSIX_SPAWN_OPEN, 0, os.devnull, os.O_RDONLY, 0),
                (os.POSIX_SPAWN_DUP2, output, 1),
                (os.POSIX_SPAWN_DUP2, output, 2),
            ],
        )
    finally:
        os.close(output)
    deadline = time.monotonic() + STARTUP
    while time.monotonic() < deadline:
        ended, status = os.waitpid(pid, os.WNOHANG)
        if ended:
            code = os.waitstatus_to_exitcode(status)
            if code == 0:
                return None
            raise DesktopError(
                f"the Desktop ended at start (exit code {code}); in {shell_path(log)}:\n"
                + _ending(log)
            )
        time.sleep(POLL)
    return pid
