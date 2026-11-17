"""systemd scopes: running a process in a cgroup of its own, apart from what started it.

systemd stops a unit by killing its whole cgroup, and systemd-oomd kills whole cgroups under
memory pressure; a process stays in the cgroup of the process that forked it, however it
detaches. `systemd-run --user --scope` moves a command into a new scope of the user manager, then
becomes the command, keeping its process ID.

Where that command ends while its scope starts, e.g. killed at once, systemd 255 can keep the
scope active, empty, until logout; nothing joins such a scope again, so `stop_empty` stops it.
"""

import codecs
import logging
import shutil
import subprocess
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger(__name__)

TIMEOUT = 5.0  # seconds for systemctl to answer; the user manager is local
CGROUPS = Path("/sys/fs/cgroup")  # cgroup v2


@dataclass(frozen=True)
class Scopes:
    """The systemd user manager, reachable: its environment, and a way into scopes of it."""

    systemd_run: str  # its path
    environment: Mapping[str, str]  # that of the manager, as the apps of a desktop session get it
    systemctl: str = "systemctl"  # its path

    def command(self, command: Sequence[str], *, unit: str | None, description: str) -> list[str]:
        """`command`, run in a new scope: named `unit` (`<unit>.scope`), else one systemd names."""
        named = [f"--unit={unit}"] if unit else []
        return [
            self.systemd_run,
            "--user",
            "--scope",
            "--quiet",
            "--collect",  # gone once it ends, even after a failure
            *named,
            f"--description={description}",
            "--",
            *command,
        ]

    def stop_empty(self, pattern: str) -> list[str]:
        """Stops the active scopes named as `pattern` (a glob) that hold no process; their names.

        Best effort: what fails is logged. A scope that is still starting, empty for a moment, is
        spared.
        """
        manager = _manager_cgroup(self.systemctl)
        if manager is None:
            return []
        # The slices of the manager, e.g. app.slice, where systemd-run puts a scope.
        empty = [
            events.parent.name
            for events in (CGROUPS / manager.lstrip("/")).glob(f"*/{pattern}/cgroup.events")
            if "populated 0" in _read(events).splitlines()
        ]
        if not empty:
            return []
        shown = _systemctl(self.systemctl, "show", "--property=Id,ActiveState", "--", *empty)
        if shown is None:
            return []
        units = [block for block in shown.split("\n\n") if block.strip()]
        stopped = [
            unit
            for block in units
            for unit in [_property(block, "Id")]
            if unit in empty and _property(block, "ActiveState") == "active"
        ]
        if stopped and _systemctl(self.systemctl, "stop", "--", *stopped) is not None:
            log.info("stopped empty scopes: %s", " ".join(stopped))
            return stopped
        return []


def _systemctl(systemctl: str, *args: str) -> str | None:
    """What `systemctl --user` prints, or None where it fails, logged."""
    try:
        result = subprocess.run(  # noqa: S603 - arguments are a list, never passed through a shell
            [systemctl, "--user", *args],
            capture_output=True,
            text=True,
            errors="surrogateescape",
            check=False,
            timeout=TIMEOUT,
        )
    except (OSError, subprocess.SubprocessError) as error:
        log.warning("systemctl %s failed: %s", args[0], error)
        return None
    if result.returncode != 0:
        log.warning("systemctl %s failed: %s", args[0], result.stderr.strip())
        return None
    return result.stdout


def _manager_cgroup(systemctl: str) -> str | None:
    """The cgroup of the user manager, e.g. `/user.slice/user-1000.slice/user@1000.service`."""
    shown = _systemctl(systemctl, "show", "--property=ControlGroup", "--value")
    if shown is None:
        return None
    return shown.strip() or None


def _property(block: str, name: str) -> str:
    """The value of a property in what `systemctl show` prints for one unit."""
    return next(
        (line.partition("=")[2] for line in block.splitlines() if line.startswith(f"{name}=")), ""
    )


def _read(path: Path) -> str:
    try:
        return path.read_text()
    except OSError:  # gone meanwhile
        return ""


def parse_environment(text: str) -> dict[str, str]:
    """Variables from `systemctl show-environment`; lines it cannot read are skipped.

    It writes `NAME=value`, or `NAME=$'…'` with C escapes where a value has special characters.
    """
    variables: dict[str, str] = {}
    for line in text.splitlines():
        name, equals, value = line.partition("=")
        if not equals or not name:
            continue
        if len(value) >= len("$''") and value.startswith("$'") and value.endswith("'"):
            try:
                raw = codecs.escape_decode(value[2:-1].encode())[0]
            except ValueError:
                log.warning(
                    "skipped the systemd variable %s, which has an escape we cannot read", name
                )
                continue
            value = raw.decode(errors="surrogateescape")
        variables[name] = value
    return variables


def detect() -> Scopes | None:
    """The systemd user manager, if it answers here and systemd-run exists; else None.

    None e.g. on clusters, in containers or in an SSH session without a user manager.
    """
    systemctl, systemd_run = shutil.which("systemctl"), shutil.which("systemd-run")
    if systemctl is None or systemd_run is None:
        return None
    try:
        result = subprocess.run(  # noqa: S603 - arguments are a list, never passed through a shell
            [systemctl, "--user", "show-environment"],
            capture_output=True,
            text=True,
            errors="surrogateescape",
            check=False,
            timeout=TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        # Its manager is there but stuck, e.g. under heavy load: worth knowing, unlike its absence.
        log.warning("no systemd scopes: systemctl did not answer within %g s", TIMEOUT)
        return None
    except (OSError, subprocess.SubprocessError) as error:
        log.info("no systemd scopes: systemctl failed: %s", error)
        return None
    if result.returncode != 0:
        log.info("no systemd scopes: %s", result.stderr.strip() or f"exit code {result.returncode}")
        return None
    return Scopes(systemd_run, parse_environment(result.stdout), systemctl)
