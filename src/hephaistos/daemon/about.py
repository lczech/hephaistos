"""What hephaistos runs and on what, for reporting an issue: versions, the system, the locale.

It leaves out what would identify the user, as paths and names do.
"""

import os
import platform
import sqlite3
from collections.abc import Mapping
from pathlib import Path
from typing import TypedDict

from hephaistos import __version__
from hephaistos.core import serialize
from hephaistos.core.db.sessions import SCHEMA_VERSION
from hephaistos.core.terminals import tmux
from hephaistos.core.terminals.keeper import KeeperError
from hephaistos.core.utils import git
from hephaistos.core.utils.paths import SOURCE, own_checkout
from hephaistos.daemon import unit

# What precedes the time zone in the path /etc/localtime links to: /usr/share/zoneinfo/Etc/UTC
ZONEINFO = "zoneinfo/"
LOCALTIME = Path("/etc/localtime")


def running_version(source: Path = SOURCE) -> str:
    """Our version, with the commit it runs from a checkout, e.g. `0.1.0 (bfc66f6-dirty)`."""
    if (checkout := own_checkout(source)) is None:
        return __version__
    described = git.describe(checkout)
    return __version__ if described is None else f"{__version__} ({described})"


class AboutJson(TypedDict):
    """What runs, and on what; None for what isn't known."""

    version: str  # e.g. `0.1.0 (bfc66f6-dirty)`
    api: str  # e.g. `0.22`
    schema: int  # the database's
    python: str
    sqlite: str
    git: str | None
    tmux: str | None
    systemd: str | None
    os: str | None  # e.g. `Ubuntu 26.04 LTS`
    kernel: str
    desktop: str | None  # e.g. `GNOME on wayland`
    locale: str | None  # e.g. `en_GB.UTF-8`
    time_zone: str | None  # e.g. `Europe/Berlin`


def _os() -> str | None:
    try:
        return platform.freedesktop_os_release().get("PRETTY_NAME")
    except OSError:
        return None


def _git() -> str | None:
    try:
        return git.installation().version.removeprefix("git version ")
    except git.GitError:
        return None


def _tmux() -> str | None:
    try:
        return tmux.installation(tmux.binary()).text.removeprefix("tmux ")
    except KeeperError:
        return None


def _desktop(env: Mapping[str, str]) -> str | None:
    desktop, session = env.get("XDG_CURRENT_DESKTOP"), env.get("XDG_SESSION_TYPE")
    if desktop and session:
        return f"{desktop} on {session}"
    return desktop or session or None


def _locale(env: Mapping[str, str]) -> str | None:
    return env.get("LC_ALL") or env.get("LC_CTYPE") or env.get("LANG") or None


def _time_zone(env: Mapping[str, str]) -> str | None:
    if zone := env.get("TZ", "").removeprefix(":"):
        return zone
    try:
        target = str(LOCALTIME.resolve(strict=True))
    except OSError:
        return None
    _, found, zone = target.partition(ZONEINFO)
    return zone if found and zone else None


def about(env: Mapping[str, str] = os.environ) -> AboutJson:
    """What runs in this process, and on what."""
    major, minor = serialize.API_VERSION
    desktop, locale = _desktop(env), _locale(env)
    if desktop is None or locale is None:
        # A Daemon under systemd starts before any desktop, so lacks its variables; systemd
        # gives them to user services that start later, as the desktop sets them there.
        user = unit.user_environment()
        desktop, locale = desktop or _desktop(user), locale or _locale(user)
    return AboutJson(
        version=running_version(),
        api=f"{major}.{minor}",
        schema=SCHEMA_VERSION,
        python=platform.python_version(),
        sqlite=sqlite3.sqlite_version,
        git=_git(),
        tmux=_tmux(),
        systemd=unit.version(),
        os=_os(),
        kernel=platform.release(),
        desktop=desktop,
        locale=locale,
        time_zone=_time_zone(env),
    )
