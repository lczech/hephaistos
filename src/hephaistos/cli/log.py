"""`hephaistos log`: show and prune this Machine's log."""

import logging
import re
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Annotated

import typer

from hephaistos.cli import terminal
from hephaistos.cli.output import JsonOption, LimitOption, ReverseOption, parse_time
from hephaistos.core import config, serialize
from hephaistos.core.utils import logs
from hephaistos.core.utils.logs import Entry, LevelName, ProcessName, record_text
from hephaistos.core.utils.paths import Paths, short_path
from hephaistos.core.utils.text import number_text

app = typer.Typer(
    no_args_is_help=True, help="The log: what hephaistos did on this machine, for debugging it."
)

_DAYS = re.compile(r"(\d+)d")

log = logging.getLogger(__name__)


def _directory() -> Path:
    """Where this Machine's log files are."""
    return Paths.from_environment().state_dir


def _shown(entry: Entry, *, as_json: bool, brief: bool) -> str:
    """A record as `log show` prints it."""
    if as_json:
        return logs.json_text(serialize.log_entry_json(entry))
    return record_text(entry.record, dated=True, brief=brief)


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
    reverse: ReverseOption = False,
    follow: Annotated[
        bool, typer.Option("--follow", "-f", help="Then show new records as they come.")
    ] = False,
    brief: Annotated[
        bool, typer.Option("--brief", help="Only the last line of each traceback.")
    ] = False,
    no_pager: Annotated[bool, typer.Option("--no-pager", help="Don't page the output.")] = False,
    as_json: JsonOption = False,
) -> None:
    """Show the newest records of the log, oldest first.

    As JSON, one `{"position": …, "record": …}` per line: the record as written, and its day
    file and line.
    """
    if follow and until:
        raise typer.BadParameter("shows records as they come; leave out --until", param_hint="-f")
    if follow and reverse:
        raise typer.BadParameter("shows new records last; leave out --reverse", param_hint="-f")
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
    entries = reading.entries if reverse else reading.entries[::-1]
    shown = [_shown(entry, as_json=as_json, brief=brief) for entry in entries]
    if reading.skipped:
        typer.echo(f"skipped {number_text(reading.skipped, 'unreadable line')}", err=True)
    if not follow:
        if shown:
            (typer.echo if no_pager else terminal.page)("\n".join(shown))
        return
    for text in shown:
        typer.echo(text)
    for entry in logs.follow(directory, selection, reading):
        typer.echo(_shown(entry, as_json=as_json, brief=brief))


def _keep_days(value: str) -> int:
    """Days given as `7d`."""
    if match := _DAYS.fullmatch(value):
        return int(match[1])
    raise typer.BadParameter(f"{value!r} is not a number of days like 7d", param_hint="--keep")


@app.command()
def prune(
    keep: Annotated[
        str | None,
        typer.Option(
            "--keep",
            "-k",
            help="Keep today's file and those of this many days before, e.g. 7d; delete older"
            " ones. Default: log.retention_days.",
        ),
    ] = None,
    *,
    yes: Annotated[bool, typer.Option("--yes", help="Delete without asking.")] = False,
) -> None:
    """Delete old log files, by whole days; those past retention are deleted daily anyway."""
    days = config.settings().log.retention_days if keep is None else _keep_days(keep)
    before = datetime.now(UTC).date() - timedelta(days=days)
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
