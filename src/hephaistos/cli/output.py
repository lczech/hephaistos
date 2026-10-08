"""Plain text and JSON output."""

import json
import re
from collections.abc import Callable, Sequence
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated

import typer

from hephaistos.core import config
from hephaistos.core.config import TimeFormat
from hephaistos.core.utils.paths import Paths

JsonOption = Annotated[bool, typer.Option("--json", help="Output as JSON.")]
TimeFormatOption = Annotated[
    TimeFormat | None,
    typer.Option("--time-format", help="How to show times; overrides the config's time_format."),
]
LimitOption = Annotated[
    int, typer.Option("--limit", "-n", min=0, help="Show at most this many; 0 for all.")
]

_UNIT_SECONDS = {"s": 1, "m": 60, "h": 60 * 60, "d": 24 * 60 * 60}
_DURATION = re.compile(r"(\d+)([smhd])")


def parse_time(value: str, now: datetime, option: str = "--since") -> datetime:
    """A duration before `now` (`2h`), or a date or time in ISO form, local unless it says."""
    if match := _DURATION.fullmatch(value):
        return now - timedelta(seconds=int(match[1]) * _UNIT_SECONDS[match[2]])
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        raise typer.BadParameter(
            f"{value!r} is neither a duration like 2h nor a date like 2026-10-05",
            param_hint=option,
        ) from None
    return parsed if parsed.tzinfo else parsed.astimezone()


def number_text(count: int, noun: str, plural: str | None = None) -> str:
    """`1 Clone`, `2 Clones`; `plural` for nouns not ending in `s` there."""
    return f"{count} {noun if count == 1 else plural or noun + 's'}"


def short_path(path: Path) -> str:
    """The path with the home directory shortened to ~."""
    home = Path.home()
    if path == home:
        return "~"
    if path.is_relative_to(home):
        return f"~/{path.relative_to(home)}"
    return str(path)


def full_time(value: datetime) -> str:
    """A point in time in local time, e.g. `2026-10-05 14:03:21`."""
    return value.astimezone().strftime("%Y-%m-%d %H:%M:%S")


_MINUTE = 60
_HOUR = 60 * _MINUTE
_DAY = 24 * _HOUR


def relative_time(value: datetime, now: datetime) -> str:
    """How long ago, e.g. `now`, `3m`, `2h`, `5d`; times ahead of `now` (clock skew) are `now`."""
    seconds = (now - value).total_seconds()
    if seconds < _MINUTE:
        return "now"
    if seconds < _HOUR:
        return f"{int(seconds // _MINUTE)}m"
    if seconds < _DAY:
        return f"{int(seconds // _HOUR)}h"
    return f"{int(seconds // _DAY)}d"


def short_time(value: datetime, now: datetime) -> str:
    """In local time, as `ls` does: `14:03` today, `10-05 14:03` this year, else `2025-10-05`."""
    local, today = value.astimezone(), now.astimezone()
    if local.date() == today.date():
        return f"{local:%H:%M}"
    if local.year == today.year:
        return f"{local:%m-%d %H:%M}"
    return f"{local:%Y-%m-%d}"


def chosen_time_format(option: TimeFormat | None, default: TimeFormat) -> TimeFormat:
    """The time format `--time-format` says, else the config, else `default`."""
    return option or config.load(Paths.from_environment().config_file).time_format or default


def time_formatter(
    option: TimeFormat | None, default: TimeFormat, now: datetime | None = None
) -> Callable[[datetime], str]:
    """Formats times as `--time-format` says, else as the config says, else as `default`."""
    chosen = chosen_time_format(option, default)
    reference = now or datetime.now(UTC)
    match chosen:
        case TimeFormat.RELATIVE:
            return lambda value: relative_time(value, reference)
        case TimeFormat.SHORT:
            return lambda value: short_time(value, reference)
        case TimeFormat.FULL:
            return full_time


def print_fields(fields: Sequence[tuple[str, str]], indent: str = "") -> None:
    """Prints `label  value` lines, with the values aligned."""
    width = max((len(label) for label, _ in fields), default=0)
    for label, value in fields:
        typer.echo(f"{indent}{label:<{width}}  {value}")


def print_table(headers: Sequence[str], rows: Sequence[Sequence[str]]) -> None:
    """Prints rows under a header line, with the columns aligned."""
    widths = [max(len(row[column]) for row in (headers, *rows)) for column in range(len(headers))]
    for row in (headers, *rows):
        typer.echo(
            "  ".join(f"{cell:<{width}}" for cell, width in zip(row, widths, strict=True)).rstrip()
        )


def print_json(value: object) -> None:
    """Prints a value as indented JSON."""
    typer.echo(json.dumps(value, indent=2))
