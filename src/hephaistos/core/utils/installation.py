"""How an installed part, such as the systemd unit for the Daemon, differs from this command.

A part installed by another hephaistos instance, or for other directories, belongs to another
installation,
e.g. the real one when this shell has a scratch HEPHAISTOS_HOME.
"""

from collections.abc import Sequence
from dataclasses import dataclass

NOT_SET = "not set"


@dataclass(frozen=True)
class Difference:
    """A setting with one value in the installed part, and another for this command."""

    name: str  # e.g. `HEPHAISTOS_HOME`
    installed: str | None  # None if the installed part does not set it
    current: str | None  # None if this command does not set it


def value_text(value: str | None) -> str:
    """A value as messages show it."""
    return NOT_SET if value is None else value


def inline_text(differences: Sequence[Difference], installed: str, current: str) -> str:
    """The differences in one line: `HEPHAISTOS_HOME: not set in the unit, /x in this shell`.

    `installed` and `current` name the two sides, e.g. `the unit` and `this shell`.
    """
    return "; ".join(
        f"{difference.name}: {value_text(difference.installed)} in {installed},"
        f" {value_text(difference.current)} in {current}"
        for difference in differences
    )
