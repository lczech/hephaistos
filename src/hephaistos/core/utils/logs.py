"""Log files: diagnostics about hephaistos itself, local to this Machine, never synced.

One JSON record per line, one file per UTC day. Several processes append to the same file:
each record is one write on an O_APPEND descriptor, so records don't interleave on local
filesystems. Files are never rewritten; the first record of a day deletes the old ones.
Readers skip lines that aren't records, e.g. cut short by a crash.
"""

import json
import logging
import os
import re
import sys
import threading
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from types import TracebackType
from typing import override

from hephaistos.core import config

FOLLOW_INTERVAL = 0.5  # seconds between looking for new records

type Record = dict[str, object]  # as written: `at`, `level`, `message`, …

_DAY_FILE = re.compile(r"(\d{4}-\d{2}-\d{2})\.jsonl")
# What every LogRecord has; anything else was passed as `extra` and becomes a field.
_STANDARD = frozenset(vars(logging.LogRecord("", 0, "", 0, "", (), None))) | {"message"}


def day_file(directory: Path, day: date) -> Path:
    """The log file of a UTC day."""
    return directory / f"{day.isoformat()}.jsonl"


def day_files(directory: Path) -> list[tuple[date, Path]]:
    """The log files in `directory` by their day, oldest first."""
    try:
        paths = list(directory.iterdir())
    except FileNotFoundError:
        return []
    found: list[tuple[date, Path]] = []
    for path in paths:
        if match := _DAY_FILE.fullmatch(path.name):
            try:
                found.append((date.fromisoformat(match[1]), path))
            except ValueError:
                continue  # not a day, e.g. 2026-13-01
    return sorted(found)


def delete_older(directory: Path, day: date) -> list[Path]:
    """Deletes the log files of the days before `day`; returns them."""
    deleted: list[Path] = []
    for older, path in day_files(directory):
        if older < day:
            path.unlink(missing_ok=True)
            deleted.append(path)
    return deleted


def json_text(record: Record) -> str:
    """A record as one line of JSON; lone surrogates (from undecodable names) as escapes."""
    text = json.dumps(record, ensure_ascii=False, default=str)
    return text.encode(errors="backslashreplace").decode()


def record_time(record: logging.LogRecord) -> datetime:
    """When a record was made, in UTC."""
    return datetime.fromtimestamp(record.created, UTC)


class JsonFormatter(logging.Formatter):
    """A record as one line of JSON: its standard fields, its extra ones, and any traceback."""

    def __init__(self, process: str) -> None:
        """Formats records of a process of this kind: `cli` or `daemon`."""
        super().__init__()
        self.process = process

    def fields(self, record: logging.LogRecord) -> dict[str, object]:
        """The record's fields, in the order they are written."""
        at = record_time(record).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        fields: dict[str, object] = {
            "at": at,
            "level": record.levelname,
            "process": self.process,
            "pid": record.process,
            "logger": record.name,
            "message": record.getMessage(),
        }
        fields |= {key: value for key, value in vars(record).items() if key not in _STANDARD}
        if record.exc_info:
            fields["error"] = self.formatException(record.exc_info)
        if record.stack_info:
            fields["stack"] = self.formatStack(record.stack_info)
        return fields

    @override
    def format(self, record: logging.LogRecord) -> str:
        return json_text(self.fields(record))


class DayFileHandler(logging.Handler):
    """Appends records to the file of their UTC day, deleting files past `log.retention_days`.

    Logging is best effort: the first failure is kept in `failure` and ends writing.
    """

    def __init__(self, directory: Path, process: str) -> None:
        """Writes into `directory`, created when needed."""
        super().__init__()
        self.directory = directory
        self.failure: OSError | None = None
        self._day: date | None = None
        self.setFormatter(JsonFormatter(process))

    @override
    def emit(self, record: logging.LogRecord) -> None:
        if self.failure is not None:
            return
        try:
            line = (self.format(record) + "\n").encode()
            day = record_time(record).date()
            path = day_file(self.directory, day)
            new_day = day != self._day and not path.exists()
            if day != self._day:
                self.directory.mkdir(parents=True, exist_ok=True)
                self._day = day
            descriptor = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o644)
            try:
                os.write(descriptor, line)  # one write per record, so records don't interleave
            finally:
                os.close(descriptor)
            if new_day:
                kept = config.settings().log.retention_days
                delete_older(self.directory, day - timedelta(days=kept))
        except OSError as error:
            self.failure = error


_log = logging.getLogger(__name__)
_installed: list[logging.Handler] = []


def _log_uncaught(
    kind: type[BaseException], value: BaseException, traceback: TracebackType | None
) -> None:
    """Logs an exception that nothing caught, then reports it as Python would."""
    if not issubclass(kind, KeyboardInterrupt):
        _log.critical("uncaught %s", kind.__name__, exc_info=(kind, value, traceback))
    sys.__excepthook__(kind, value, traceback)


def _log_uncaught_in_thread(args: threading.ExceptHookArgs) -> None:
    """Logs an exception that ended a thread, then reports it as Python would."""
    if args.exc_value is not None and not isinstance(args.exc_value, SystemExit):
        name = args.thread.name if args.thread else "a thread"
        exc_info = (args.exc_type, args.exc_value, args.exc_traceback)
        _log.critical("uncaught %s in %s", args.exc_type.__name__, name, exc_info=exc_info)
    threading.__excepthook__(args)


def start(handlers: list[logging.Handler], level: int) -> None:
    """Sends all records at `level` and above to `handlers`, also uncaught exceptions.

    Replaces what an earlier `start` set up.
    """
    stop()
    root = logging.getLogger()
    root.setLevel(level)
    for handler in handlers:
        root.addHandler(handler)
        _installed.append(handler)
    sys.excepthook = _log_uncaught
    threading.excepthook = _log_uncaught_in_thread


def stop() -> None:
    """Undoes `start`."""
    root = logging.getLogger()
    for handler in _installed:
        root.removeHandler(handler)
        handler.close()
    _installed.clear()
    root.setLevel(logging.WARNING)
    sys.excepthook = sys.__excepthook__
    threading.excepthook = threading.__excepthook__


def parsed(line: bytes) -> Record | None:
    """The record on a line; None if there is none."""
    try:
        record = json.loads(line)
    except ValueError:
        return None
    if not isinstance(record, dict):
        return None
    fields: Record = record  # pyright: ignore[reportUnknownVariableType]
    if not all(isinstance(fields.get(key), str) for key in ("at", "level", "message")):
        return None
    try:
        datetime.fromisoformat(str(fields["at"]))
    except ValueError:
        return None
    return fields


def record_at(record: Record) -> datetime:
    """When a record was made; its `at` was checked when it was parsed."""
    return datetime.fromisoformat(str(record["at"]))


@dataclass(frozen=True)
class Selection:
    """Which records to read; all by default."""

    since: datetime | None = None
    until: datetime | None = None
    level: int = logging.NOTSET  # and above
    process: str | None = None
    pid: int | None = None

    def covers(self, day: date) -> bool:
        """Whether a UTC day's file may hold selected records."""
        return (self.since is None or day >= self.since.astimezone(UTC).date()) and (
            self.until is None or day <= self.until.astimezone(UTC).date()
        )

    def matches(self, record: Record) -> bool:
        """Whether a record is selected."""
        at = record_at(record)
        level = logging.getLevelNamesMapping().get(str(record["level"]), logging.NOTSET)
        return (
            (self.since is None or at >= self.since)
            and (self.until is None or at <= self.until)
            and level >= self.level
            and (self.process is None or record.get("process") == self.process)
            and (self.pid is None or record.get("pid") == self.pid)
        )


@dataclass(frozen=True)
class Reading:
    """The records read, oldest first, and where to follow on from."""

    records: list[Record]
    skipped: int  # lines that aren't records
    today: date
    offset: int  # in today's file, after its last complete line


def read(
    directory: Path, selection: Selection, limit: int = 0, today: date | None = None
) -> Reading:
    """The newest `limit` selected records (0: all), reading the newest files first.

    The last line of today's file is left out unless complete: it may still be written.
    """
    today = today or datetime.now(UTC).date()
    offset = 0
    skipped = 0
    newest_first: list[list[Record]] = []
    for day, path in reversed(day_files(directory)):
        if not selection.covers(day):
            continue
        data = path.read_bytes()
        if day == today:
            data = data[: data.rfind(b"\n") + 1]
            offset = len(data)
        found: list[Record] = []
        for line in data.splitlines():
            record = parsed(line)
            if record is None:
                skipped += bool(line.strip())
            elif selection.matches(record):
                found.append(record)
        newest_first.append(found)
        if limit and sum(map(len, newest_first)) >= limit:
            break
    records = [record for found in reversed(newest_first) for record in found]
    return Reading(records[-limit:] if limit else records, skipped, today, offset)


def follow(
    directory: Path,
    selection: Selection,
    after: Reading,
    *,
    today: Callable[[], date] = lambda: datetime.now(UTC).date(),
    sleep: Callable[[float], None] = time.sleep,
) -> Iterator[Record]:
    """The selected records written after a reading, as they come; never ends.

    Moves on to the next day's file once the day is over and its file stays unchanged.
    """
    day, offset, pending = after.today, after.offset, b""
    while True:
        try:
            with day_file(directory, day).open("rb") as file:
                file.seek(offset)
                chunk = file.read()
        except FileNotFoundError:
            chunk = b""
        offset += len(chunk)
        *lines, pending = (pending + chunk).split(b"\n")
        for line in lines:
            if (record := parsed(line)) is not None and selection.matches(record):
                yield record
        if not chunk and (current := today()) != day:
            day, offset, pending = current, 0, b""
            continue
        sleep(FOLLOW_INTERVAL)
