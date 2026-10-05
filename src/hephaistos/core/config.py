"""This Machine's settings, from an optional TOML file; built-in defaults apply.

Settings at the top apply to every Machine reading the file (e.g. sharing a home directory);
a section `[machines.<hostname>]` overrides them on that Machine. The hostname may be given in
full or as its first part.
"""

import socket
import tomllib
from dataclasses import dataclass, fields
from enum import StrEnum
from pathlib import Path
from typing import Any, cast

from hephaistos.core.utils.errors import HephaistosError


class TimeFormat(StrEnum):
    """How times are shown: `3m`, `14:03`, or `2026-10-05 14:03:21`."""

    RELATIVE = "relative"
    SHORT = "short"
    FULL = "full"


@dataclass(frozen=True)
class Config:
    """All settings, with their defaults."""

    # None: relative in lists, full in `show`.
    time_format: TimeFormat | None = None


class ConfigError(HephaistosError):
    """The config file can't be read or has invalid settings."""


_SETTINGS = frozenset(field.name for field in fields(Config))


def _check(path: Path, values: dict[str, Any], where: str) -> None:
    """Raises ConfigError for unknown settings or invalid values."""
    unknown = sorted(set(values) - _SETTINGS)
    if unknown:
        raise ConfigError(f"{path}: unknown settings{where}: {', '.join(unknown)}")
    time_format = values.get("time_format")
    if time_format is not None and time_format not in set(TimeFormat):
        choices = ", ".join(TimeFormat)
        raise ConfigError(
            f"{path}: time_format{where} must be one of {choices}, not {time_format!r}"
        )


def _sections(path: Path, value: object) -> dict[str, dict[str, Any]]:
    """The `[machines.<hostname>]` sections, checked."""
    if not isinstance(value, dict) or not all(
        isinstance(section, dict) for section in cast("dict[str, object]", value).values()
    ):
        raise ConfigError(f"{path}: machines must hold one section per hostname")
    sections = cast("dict[str, dict[str, Any]]", value)
    for hostname, section in sections.items():
        _check(path, section, f" in [machines.{hostname}]")
    return sections


def load(path: Path, hostname: str | None = None) -> Config:
    """The settings in `path` for this Machine (or `hostname`); defaults if there is no file."""
    try:
        data = tomllib.loads(path.read_text())
    except FileNotFoundError:
        return Config()
    except (OSError, UnicodeDecodeError, tomllib.TOMLDecodeError) as error:
        raise ConfigError(f"cannot read {path}: {error}") from error

    sections = _sections(path, data.pop("machines", {}))
    _check(path, data, "")
    hostname = hostname or socket.gethostname()
    # The short name first, so that a section with the full name wins.
    for name in dict.fromkeys((hostname.partition(".")[0], hostname)):
        data |= sections.get(name, {})
    time_format = data.get("time_format")
    return Config(time_format=None if time_format is None else TimeFormat(time_format))
