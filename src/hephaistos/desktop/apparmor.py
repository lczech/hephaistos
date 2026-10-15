"""The AppArmor profile that lets the Desktop's Electron use Chromium's sandbox.

Ubuntu (from 24.04) lets only programs with a profile create user namespaces, which the sandbox
needs; without one, Electron aborts at start. Ubuntu ships such profiles for Chrome and VS Code.
"""

import shlex
from pathlib import Path

RESTRICTION = Path("/proc/sys/kernel/apparmor_restrict_unprivileged_userns")
NAME = "hephaistos-desktop"
INSTALLED = Path("/etc/apparmor.d") / NAME


def needed(restriction: Path = RESTRICTION) -> bool:
    """Whether this Machine restricts user namespaces to programs with a profile."""
    try:
        return restriction.read_text().strip() == "1"
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


def is_installed(electron: Path, installed: Path = INSTALLED) -> bool:
    """Whether our profile is installed for the Electron at this path."""
    try:
        return installed.read_text() == profile_text(electron)
    except OSError:
        return False


def commands(source: Path, installed: Path = INSTALLED) -> list[list[str]]:
    """What installs the profile written to `source`, and loads it; as root."""
    return [
        ["install", "-m", "644", str(source), str(installed)],
        ["apparmor_parser", "-r", str(installed)],
    ]


def script(source: Path, installed: Path = INSTALLED) -> str:
    """The commands as one shell line, for one sudo."""
    return " && ".join(shlex.join(command) for command in commands(source, installed))
