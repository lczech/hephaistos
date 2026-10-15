"""The AppArmor profile that lets the Desktop's Electron use Chromium's sandbox.

Ubuntu (from 24.04) lets only programs with a profile create user namespaces, which the sandbox
needs; without one, Electron aborts at start. Ubuntu ships such profiles for Chrome and VS Code.
"""

import shlex
from pathlib import Path

RESTRICTION = Path("/proc/sys/kernel/apparmor_restrict_unprivileged_userns")
NAME = "hephaistos-desktop"
INSTALLED = Path("/etc/apparmor.d") / NAME


def needed() -> bool:
    """Whether this Machine restricts user namespaces to programs with a profile."""
    try:
        return RESTRICTION.read_text().strip() == "1"
    except OSError:
        return False


def profile_text(electron: Path) -> str:
    """Our profile for the Electron at this path: allows everything, user namespaces included."""
    return (
        "# Written by `hephaistos desktop install`: lets the Desktop's Electron use Chromium's"
        " sandbox.\n"
        "abi <abi/4.0>,\n"
        "include <tunables/global>\n\n"
        f'profile {NAME} "{electron}" flags=(unconfined) {{\n'
        "  userns,\n\n"
        f"  include if exists <local/{NAME}>\n"
        "}\n"
    )


def is_installed(electron: Path) -> bool:
    """Whether our profile is installed for the Electron at this path."""
    try:
        return INSTALLED.read_text() == profile_text(electron)
    except OSError:
        return False


def commands(source: Path) -> list[list[str]]:
    """What installs the profile written to `source`, and loads it; as root."""
    return [
        ["install", "-m", "644", str(source), str(INSTALLED)],
        ["apparmor_parser", "-r", str(INSTALLED)],
    ]


def removal_commands() -> list[list[str]]:
    """What unloads the profile and removes it; as root."""
    return [["apparmor_parser", "-R", str(INSTALLED)], ["rm", str(INSTALLED)]]


def script(commands: list[list[str]]) -> str:
    """Commands as one shell line, for one sudo."""
    return " && ".join(shlex.join(command) for command in commands)
