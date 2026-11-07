"""Checks of this Machine's setup: what hephaistos needs, each found working or not.

A problem stops or degrades a feature until the user changes something: installs, upgrades or
reinstalls; it says what to do. A note is a choice that is fine, e.g. no systemd on a cluster.
The checks run in the process that asks, with its environment, as the PATH may differ: in the
Daemon for the GUI, in the shell for the CLI. The Daemon records its own (`status.py`).
"""

import shutil
import sqlite3
from collections.abc import Callable, Mapping, Sequence
from typing import TypedDict

from hephaistos.core.db.sessions import MIN_SQLITE
from hephaistos.core.utils import git
from hephaistos.core.utils.installation import inline_text
from hephaistos.daemon import unit
from hephaistos.daemon.status import Check, Checked, Outcome
from hephaistos.daemon.unit import ForeignUnitError

INSTALL = "`hephaistos daemon install`"

# The environment of the shell that asks, whose paths the unit's are compared with; None in the
# Daemon, which is the unit's, or another on purpose, e.g. a scratch one.
type Shell = Mapping[str, str] | None


def _git(_: Shell) -> list[Check]:
    try:
        found = git.installation()
    except git.GitError as error:
        return [Check("git", "problem", str(error), "install git")]
    version = found.version.removeprefix("git version ")
    numbers = found.numbers
    if numbers is not None and numbers < git.MIN_VERSION:
        need = ".".join(map(str, git.MIN_VERSION))
        text = f"{version} is too old; need {need} or later"
        return [Check("git", "problem", text, f"upgrade git to {need} or later")]
    return [Check("git", "ok", f"{version}, {found.executable}")]


def _sqlite(_: Shell) -> list[Check]:
    need = ".".join(map(str, MIN_SQLITE[:2]))
    if sqlite3.sqlite_version_info < MIN_SQLITE:
        text = f"{sqlite3.sqlite_version} is too old; need {need} or later"
        return [Check("sqlite", "problem", text, f"use a Python built with SQLite {need} or later")]
    return [Check("sqlite", "ok", sqlite3.sqlite_version)]


def _unit(shell: Shell) -> list[Check]:
    """The Daemon's unit, if systemd runs user services here."""
    try:
        installed = unit.installed_text()
    except ForeignUnitError as error:
        return [Check("unit", "problem", str(error), f"move it away, then {INSTALL}")]
    if installed is None:
        return [
            Check(
                "unit",
                "note",
                "not installed: the daemon runs only by `hephaistos daemon run`",
                INSTALL,
            )
        ]
    found: list[Check] = []
    executable = unit.installed_executable(installed)
    if executable is not None and not executable.exists():
        text = f"it runs {executable}, which no longer exists"
        found.append(Check("unit", "problem", text, INSTALL))
    if shell is not None and (differences := unit.path_differences(installed, shell)):
        compared = inline_text(differences, "the unit", "this shell")
        text = f"it uses other directories than this shell ({compared})"
        found.append(Check("unit", "problem", text, INSTALL))
    state = unit.unit_state()
    if state is not None and not state.enabled:
        text = "installed, but disabled: the daemon doesn't start at login"
        return [*found, Check("unit", "note", text, INSTALL)]
    if not found:
        found.append(Check("unit", "ok", "installed and enabled"))
    if not unit.has_linger():
        # Fine where someone is logged in while it should run, as on a laptop.
        text = "off: the daemon starts at login, and stops at logout"
        found.append(Check("linger", "note", text, "`hephaistos daemon install --linger`"))
    else:
        found.append(Check("linger", "ok", "on: the daemon runs from boot, also when logged out"))
    return found


def _systemd(shell: Shell) -> list[Check]:
    if not unit.is_available():
        text = "no user services here"
        return [Check("systemd", "note", text, "run `hephaistos daemon run`, e.g. in tmux")]
    return [Check("systemd", "ok", unit.version() or "user services available"), *_unit(shell)]


def _ionice(_: Shell) -> list[Check]:
    found = shutil.which("ionice")
    if found is None:
        text = "not installed: passes run at normal I/O priority"
        return [Check("ionice", "note", text, "install util-linux")]
    return [Check("ionice", "ok", found)]


#: Each part's checks, given the shell's environment, if a shell asks.
CHECKS: Sequence[Callable[[Shell], list[Check]]] = (_git, _sqlite, _systemd, _ionice)


def run(shell: Shell = None) -> list[Check]:
    """All checks, in this process; `shell` is the environment of the shell that asks, if one."""
    return [check for part in CHECKS for check in part(shell)]


def unit_problems(shell: Mapping[str, str]) -> list[Check]:
    """The problems with the Daemon's unit, as `daemon status` warns of them; not linger's."""
    if not unit.is_available():
        return []
    return [check for check in _unit(shell) if check.name == "unit" and check.outcome == "problem"]


def changed(before: Sequence[Check], after: Sequence[Check]) -> list[Check]:
    """The checks in `after` that weren't in `before`: new problems, and fixed ones as ok."""
    return [check for check in after if check not in before]


class CheckJson(TypedDict):
    """What a check found."""

    name: str
    outcome: Outcome
    text: str
    fix: str | None


class CheckedJson(TypedDict):
    """The checks the Daemon ran last, and when."""

    checked_at: str
    checks: list[CheckJson]


def check_json(check: Check) -> CheckJson:
    """A check as JSON."""
    return CheckJson(name=check.name, outcome=check.outcome, text=check.text, fix=check.fix)


def checked_json(checked: Checked) -> CheckedJson:
    """The Daemon's checks as JSON."""
    return CheckedJson(
        checked_at=checked.at.isoformat(), checks=[check_json(check) for check in checked.checks]
    )
