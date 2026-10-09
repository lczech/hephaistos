"""Settings: the shipped defaults, overridden by the user's config files and environment.

Layers, each overriding the ones before it key by key: `defaults.toml` (shipped; it documents
every setting), `config.toml` (every Machine reading it, e.g. sharing a home directory),
`config.<hostname>.toml` (first part of the hostname, then all of it), and environment variables
`HEPHAISTOS_<SECTION>_<KEY>`. Command-line options override them all.

Each process loads its settings once and activates them; the Core reads them where it uses them.
"""

import difflib
import json
import logging
import os
import socket
import tomllib
from collections.abc import Mapping
from dataclasses import dataclass, fields, is_dataclass
from enum import StrEnum
from importlib.resources import files
from pathlib import Path
from typing import Annotated, Any, cast, get_args, get_origin, get_type_hints

from hephaistos.core.utils.errors import HephaistosError


class TimeFormat(StrEnum):
    """How times are shown: `3m`, `14:03`, `2026-10-05 14:03:21`, or as suits the view."""

    AUTO = "auto"
    RELATIVE = "relative"
    SHORT = "short"
    FULL = "full"


class LogLevel(StrEnum):
    """The lowest level of records written to the log."""

    DEBUG = "debug"
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"
    CRITICAL = "critical"

    @property
    def number(self) -> int:
        """The level as `logging` numbers it."""
        return logging.getLevelNamesMapping()[self.upper()]


@dataclass(frozen=True)
class AtLeast:
    """A setting's limit: at least this."""

    value: float


@dataclass(frozen=True)
class Above:
    """A setting's limit: more than this."""

    value: float


@dataclass(frozen=True)
class Log:
    """The section [log]."""

    level: LogLevel
    retention_days: Annotated[int, AtLeast(0)]


@dataclass(frozen=True)
class Git:
    """The section [git]."""

    timeout: Annotated[float, Above(0)]


@dataclass(frozen=True)
class Observe:
    """The section [observe]."""

    workers: Annotated[int, AtLeast(1)]


@dataclass(frozen=True)
class Scan:
    """The section [scan]."""

    depth: Annotated[int, AtLeast(0)]


@dataclass(frozen=True)
class Settings:
    """All settings, by section; `defaults.toml` documents them and holds their defaults."""

    time_format: TimeFormat
    log: Log
    git: Git
    observe: Observe
    scan: Scan


class ConfigError(HephaistosError):
    """A config file can't be read, or a setting is unknown or invalid."""


@dataclass(frozen=True)
class _Leaf:
    """A setting's type (int, float or a StrEnum) and limits."""

    kind: type
    limits: tuple[object, ...]


def _unwrapped(hint: object) -> tuple[type, tuple[object, ...]]:
    """A type hint's type and its `Annotated` extras."""
    if get_origin(hint) is Annotated:
        kind, *extras = get_args(hint)
        return kind, tuple(extras)
    return cast("type", hint), ()


def _is_section(kind: type) -> bool:
    """Whether a type is a section, holding settings, rather than a setting's type."""
    return is_dataclass(kind)


def _leaves(section: type, prefix: str = "") -> dict[str, _Leaf]:
    """The settings of a section and the sections in it, by key, e.g. `git.timeout`."""
    leaves: dict[str, _Leaf] = {}
    for name, hint in get_type_hints(section, include_extras=True).items():
        kind, limits = _unwrapped(hint)
        if _is_section(kind):
            leaves |= _leaves(kind, f"{prefix}{name}.")
        else:
            leaves[prefix + name] = _Leaf(kind, limits)
    return leaves


_LEAVES = _leaves(Settings)
KEYS = tuple(_LEAVES)  # every setting, e.g. `git.timeout`
_SECTIONS = frozenset(key.rpartition(".")[0] for key in _LEAVES) - {""}

DEFAULT = "default"  # the source of a value from `defaults.toml`


def variable(key: str) -> str:
    """The environment variable for a setting, e.g. `HEPHAISTOS_GIT_TIMEOUT`."""
    return "HEPHAISTOS_" + key.upper().replace(".", "_")


def unknown_text(key: str) -> str:
    """Says that a setting doesn't exist, naming the closest one that does."""
    close = difflib.get_close_matches(key, [*_LEAVES, *_SECTIONS], n=1)
    return f"unknown setting {key}" + (f" (did you mean {close[0]}?)" if close else "")


def _value_text(value: object) -> str:
    """A value as TOML-like text, for messages."""
    return json.dumps(value, default=str)


def _checked(leaf: _Leaf, value: object, where: str) -> object:
    """A value of the setting's type within its limits; raises ConfigError otherwise."""
    kind = leaf.kind
    if issubclass(kind, StrEnum):
        if value not in set(kind):
            choices = ", ".join(kind)
            raise ConfigError(f"{where} must be one of {choices}, not {_value_text(value)}")
        return kind(value)
    number = isinstance(value, int | float) and not isinstance(value, bool)
    if kind is float and number:
        value = float(cast("float", value))
    elif kind is not int or not isinstance(value, int) or isinstance(value, bool):
        expected = "a number" if kind is float else "an integer"
        raise ConfigError(f"{where} must be {expected}, not {_value_text(value)}")
    for limit in leaf.limits:
        if isinstance(limit, AtLeast) and not value >= limit.value:
            raise ConfigError(f"{where} must be at least {limit.value:g}, not {value}")
        if isinstance(limit, Above) and not value > limit.value:
            raise ConfigError(f"{where} must be more than {limit.value:g}, not {value}")
    return value


def _layer(data: Mapping[str, object], source: str, prefix: str = "") -> dict[str, object]:
    """The settings a file sets, checked, by key."""
    values: dict[str, object] = {}
    for name, value in data.items():
        key = prefix + name
        if key in _LEAVES:
            values[key] = _checked(_LEAVES[key], value, f"{source}: {key}")
        elif key in _SECTIONS:
            if not isinstance(value, dict):
                raise ConfigError(f"{source}: {key} must be a section [{key}]")
            values |= _layer(cast("dict[str, object]", value), source, f"{key}.")
        else:
            raise ConfigError(f"{source}: {unknown_text(key)}")
    return values


def _from_text(leaf: _Leaf, text: str) -> object:
    """An environment variable's value as the setting's type, where it is one."""
    for kind in (int, float):
        if leaf.kind is kind:
            try:
                return kind(text)
            except ValueError:
                return text
    return text


def _built[T](section: type[T], values: Mapping[str, object], prefix: str = "") -> T:
    """A section with its settings from `values`, which has all of them."""
    hints = get_type_hints(section, include_extras=True)
    arguments: dict[str, Any] = {}
    for field in fields(cast("Any", section)):
        kind, _ = _unwrapped(hints[field.name])
        key = prefix + field.name
        arguments[field.name] = (
            _built(kind, values, f"{key}.") if _is_section(kind) else values[key]
        )
    return section(**arguments)


_DEFAULT_VALUES = _layer(
    tomllib.loads(files("hephaistos.core").joinpath("defaults.toml").read_text()), "defaults.toml"
)
DEFAULTS = _built(Settings, _DEFAULT_VALUES)


@dataclass(frozen=True)
class Loaded:
    """Settings as loaded, and where each value comes from: a file, a variable, or `default`."""

    settings: Settings
    sources: dict[str, str]


def files_for(directory: Path, hostname: str) -> list[Path]:
    """The config files for a host, each overriding the ones before it."""
    names = dict.fromkeys(("config", f"config.{hostname.partition('.')[0]}", f"config.{hostname}"))
    return [directory / f"{name}.toml" for name in names]


def _file_layer(path: Path) -> dict[str, object]:
    """The settings a config file sets; none if there is no file."""
    try:
        data = tomllib.loads(path.read_text())
    except FileNotFoundError:
        return {}
    except (OSError, UnicodeDecodeError, tomllib.TOMLDecodeError) as error:
        raise ConfigError(f"cannot read {path}: {error}") from error
    return _layer(data, str(path))


def load(
    directory: Path, hostname: str | None = None, env: Mapping[str, str] = os.environ
) -> Loaded:
    """The settings for this Machine (or `hostname`) from the files in `directory` and `env`.

    Raises ConfigError for files that can't be read and unknown or invalid settings.
    """
    values = dict(_DEFAULT_VALUES)
    sources = dict.fromkeys(values, DEFAULT)
    for path in files_for(directory, hostname or socket.gethostname()):
        layer = _file_layer(path)
        values |= layer
        sources |= dict.fromkeys(layer, str(path))
    for key, leaf in _LEAVES.items():
        name = variable(key)
        if text := env.get(name):  # empty ones as if unset, like most tools
            values[key] = _checked(leaf, _from_text(leaf, text), f"{name}:")
            sources[key] = name
    return Loaded(_built(Settings, values), sources)


_active = DEFAULTS


def settings() -> Settings:
    """This process's settings: the defaults until `activate` sets others."""
    return _active


def activate(chosen: Settings) -> None:
    """Makes these the settings `settings` returns, in this whole process."""
    global _active  # noqa: PLW0603 - set once at startup; tests reset it
    _active = chosen
