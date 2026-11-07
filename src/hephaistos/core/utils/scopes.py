"""systemd scopes: running a process in a cgroup of its own, apart from what started it.

systemd stops a unit by killing its whole cgroup, and systemd-oomd kills whole cgroups under
memory pressure; a process forked by another stays in that one's cgroup, however it detaches.
`systemd-run --user --scope` moves a command into a new scope of the user's manager, then
becomes the command, keeping its process ID.
"""

import codecs
import logging
import shutil
import subprocess
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

log = logging.getLogger(__name__)

TIMEOUT = 5.0  # seconds for systemctl to answer; the user's manager is local


@dataclass(frozen=True)
class Scopes:
    """systemd's user manager, reachable: its environment, and a way into scopes of it."""

    systemd_run: str  # its path
    environment: Mapping[str, str]  # the manager's, as a desktop session's apps get it

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


def parse_environment(text: str) -> dict[str, str]:
    """Variables from `systemctl show-environment`; lines it can't read are skipped.

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
                    "skipped systemd's variable %s, which has an escape we can't read", name
                )
                continue
            value = raw.decode(errors="surrogateescape")
        variables[name] = value
    return variables


def detect() -> Scopes | None:
    """The user's systemd manager, if it answers here and systemd-run exists; else None.

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
        log.warning("no systemd scopes: systemctl didn't answer within %g s", TIMEOUT)
        return None
    except (OSError, subprocess.SubprocessError) as error:
        log.info("no systemd scopes: systemctl failed: %s", error)
        return None
    if result.returncode != 0:
        log.info("no systemd scopes: %s", result.stderr.strip() or f"exit code {result.returncode}")
        return None
    return Scopes(systemd_run, parse_environment(result.stdout))
