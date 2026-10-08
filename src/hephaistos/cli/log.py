"""`hephaistos log`: show and prune this Machine's log; the log as text."""

import json
import logging
import re
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Annotated, Literal, override

import typer

from hephaistos.cli import terminal
from hephaistos.cli.output import JsonOption, LimitOption, number_text, parse_time, short_path
from hephaistos.core.utils import logs
from hephaistos.core.utils.logs import JsonFormatter, Record
from hephaistos.core.utils.paths import Paths

app = typer.Typer(
    no_args_is_help=True, help="The log: what hephaistos did on this Machine, for debugging it."
)

LevelName = Literal["debug", "info", "warning", "error", "critical"]
ProcessName = Literal["cli", "daemon"]

# Fields every record has, shown in fixed places; the rest follow as `key=value`.
_FIXED = frozenset({"at", "level", "process", "pid", "logger", "message", "error", "stack"})
_DAYS = re.compile(r"(\d+)d")

log = logging.getLogger(__name__)


def _value_text(value: object) -> str:
    """A field's value: strings as they are, anything else as JSON."""
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)


def record_text(record: Record, *, dated: bool = False, brief: bool = False) -> str:
    """A record as one line in local time, with its traceback (if any) indented below.

    E.g. `14:03:21.123 INFO  cli[4242] recorded clone.moved event=… subject=…`; `dated` puts
    the day in front (`10-08 14:03:21.123`), `brief` shortens a traceback to its last line.
    """
    at = logs.record_at(record).astimezone()
    seconds = f"{at:%m-%d %H:%M:%S}" if dated else f"{at:%H:%M:%S}"
    parts = [
        f"{seconds}.{at.microsecond // 1000:03d}",
        f"{record['level']!s:<5}",
        f"{record.get('process', '?')}[{record.get('pid', '?')}]",
        str(record["message"]),
        *(f"{key}={_value_text(value)}" for key, value in record.items() if key not in _FIXED),
    ]
    lines = [" ".join(parts)]
    for key in ("error", "stack"):
        if key in record:
            below = str(record[key]).splitlines()
            if brief:
                below = [f"↳ {line}" for line in below[-1:]]
            lines += (f"    {line}" for line in below)
    # Lone surrogates (from undecodable names) can't be printed; their escapes can.
    return "\n".join(lines).encode(errors="backslashreplace").decode()


class TextFormatter(logging.Formatter):
    """Records as `record_text` shows them when read back from the log file."""

    def __init__(self, process: str) -> None:
        """Formats records of a process of this kind: `cli` or `daemon`."""
        super().__init__()
        self._json = JsonFormatter(process)

    @override
    def format(self, record: logging.LogRecord) -> str:
        return record_text(json.loads(self._json.format(record)))


def _directory() -> Path:
    """Where this Machine's log files are."""
    return Paths.from_environment().state_dir


def _shown(record: Record, *, as_json: bool, brief: bool) -> str:
    """A record as `log show` prints it."""
    return logs.json_text(record) if as_json else record_text(record, dated=True, brief=brief)


@app.command()
def show(  # noqa: PLR0913 - one option per filter
    *,
    since: Annotated[
        str | None,
        typer.Option(
            "--since", "-s", help="Only records since then: `30m`, `2h`, `3d`, or a date."
        ),
    ] = None,
    until: Annotated[
        str | None, typer.Option("--until", "-u", help="Only records until then; as --since.")
    ] = None,
    level: Annotated[
        LevelName | None, typer.Option("--level", "-l", help="Only this level or higher.")
    ] = None,
    process: Annotated[
        ProcessName | None, typer.Option("--process", help="Only records of this kind of process.")
    ] = None,
    pid: Annotated[
        int | None, typer.Option("--pid", help="Only records of this process: one run.")
    ] = None,
    limit: LimitOption = 50,
    follow: Annotated[
        bool, typer.Option("--follow", "-f", help="Then show new records as they come.")
    ] = False,
    brief: Annotated[
        bool, typer.Option("--brief", help="Only the last line of each traceback.")
    ] = False,
    no_pager: Annotated[bool, typer.Option("--no-pager", help="Don't page the output.")] = False,
    as_json: JsonOption = False,
) -> None:
    """Show the newest records of the log, oldest first; as JSON, one record per line."""
    if follow and until:
        raise typer.BadParameter("shows records as they come; leave out --until", param_hint="-f")
    now = datetime.now(UTC)
    selection = logs.Selection(
        since=parse_time(since, now) if since else None,
        until=parse_time(until, now, "--until") if until else None,
        level=logging.getLevelNamesMapping()[level.upper()] if level else logging.NOTSET,
        process=process,
        pid=pid,
    )
    directory = _directory()
    reading = logs.read(directory, selection, limit)
    shown = [_shown(record, as_json=as_json, brief=brief) for record in reading.records]
    if reading.skipped:
        typer.echo(f"skipped {number_text(reading.skipped, 'unreadable line')}", err=True)
    if not follow:
        if shown:
            (typer.echo if no_pager else terminal.page)("\n".join(shown))
        return
    for text in shown:
        typer.echo(text)
    for record in logs.follow(directory, selection, reading):
        typer.echo(_shown(record, as_json=as_json, brief=brief))


def _keep_days(value: str) -> int:
    """Days given as `7d`."""
    if match := _DAYS.fullmatch(value):
        return int(match[1])
    raise typer.BadParameter(f"{value!r} is not a number of days like 7d", param_hint="--keep")


@app.command()
def prune(
    keep: Annotated[
        str,
        typer.Option(
            "--keep",
            "-k",
            help="Keep today's file and those of this many days before; delete older ones.",
        ),
    ] = f"{logs.RETENTION_DAYS}d",
    *,
    yes: Annotated[bool, typer.Option("--yes", help="Delete without asking.")] = False,
) -> None:
    """Delete old log files, whole days at a time; each day deletes those past 30 days anyway."""
    before = datetime.now(UTC).date() - timedelta(days=_keep_days(keep))
    directory = _directory()
    old = [(day, path) for day, path in logs.day_files(directory) if day < before]
    if not old:
        typer.echo("Nothing to prune")
        return
    size = sum(path.stat().st_size for _, path in old)
    if not yes:
        typer.echo(f"Log files in {short_path(directory)} to delete:")
        typer.echo(f"  {_days_text(old[0][0], old[-1][0])}: {number_text(len(old), 'file')}")
        terminal.confirm(f"Delete them ({_size_text(size)})?", default=False, action="delete them")
    deleted = logs.delete_older(directory, before)
    log.info("pruned %s", number_text(len(deleted), "file"), extra={"before": before})
    typer.echo(f"Deleted {number_text(len(deleted), 'log file')} ({_size_text(size)})")


def _days_text(first: date, last: date) -> str:
    """A range of days, or one day."""
    return str(first) if first == last else f"{first} to {last}"


_KB = 1000
_MB = 1000 * _KB


def _size_text(size: int) -> str:
    """A file size in kB or MB."""
    return f"{size / _MB:.1f} MB" if size >= _MB else f"{max(size // _KB, 1)} kB"
