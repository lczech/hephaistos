"""Plain text and JSON output."""

import json
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from typing import Annotated

import typer

from hephaistos.core import config
from hephaistos.core.config import TimeFormat
from hephaistos.core.utils import times

JsonOption = Annotated[bool, typer.Option("--json", help="Output as JSON.")]
TimeFormatOption = Annotated[
    TimeFormat | None,
    typer.Option("--time-format", help="How to show times; overrides the setting time_format."),
]
LimitOption = Annotated[
    int, typer.Option("--limit", "-n", min=0, help="Show at most this many; 0 for all.")
]


def parse_time(value: str, now: datetime, option: str = "--since") -> datetime:
    """A duration before `now` (`2h`), or a date or time in ISO form, local unless it says."""
    try:
        return times.parse_time(value, now)
    except ValueError as error:
        raise typer.BadParameter(str(error), param_hint=option) from None


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
    """The time format `--time-format` says, else the setting; `default` for `auto`."""
    chosen = option or config.settings().time_format
    return default if chosen is TimeFormat.AUTO else chosen


def time_formatter(
    option: TimeFormat | None, default: TimeFormat, now: datetime | None = None
) -> Callable[[datetime], str]:
    """Formats times as `--time-format` says, else as the setting says; `default` for `auto`."""
    chosen = chosen_time_format(option, default)
    reference = now or datetime.now(UTC)
    match chosen:
        case TimeFormat.RELATIVE:
            return lambda value: relative_time(value, reference)
        case TimeFormat.SHORT:
            return lambda value: short_time(value, reference)
        case TimeFormat.FULL | TimeFormat.AUTO:  # `auto` only if `default` is
            return full_time


def print_fields(fields: Sequence[tuple[str, str]], indent: str = "") -> None:
    """Prints `label  value` lines, with the values aligned."""
    width = max((len(label) for label, _ in fields), default=0)
    for label, value in fields:
        typer.echo(f"{indent}{label:<{width}}  {value}")


def print_rows(rows: Sequence[Sequence[str]]) -> None:
    """Prints rows with the columns aligned."""
    widths = [max(len(row[column]) for row in rows) for column in range(len(rows[0]))]
    for row in rows:
        typer.echo(
            "  ".join(f"{cell:<{width}}" for cell, width in zip(row, widths, strict=True)).rstrip()
        )


def print_table(headers: Sequence[str], rows: Sequence[Sequence[str]]) -> None:
    """Prints rows under a header line, with the columns aligned."""
    print_rows([headers, *rows])


def print_json(value: object) -> None:
    """Prints a value as indented JSON."""
    typer.echo(json.dumps(value, indent=2))
