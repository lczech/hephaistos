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
from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from types import TracebackType
from typing import Literal, NamedTuple, Self, override

from hephaistos.core import config
from hephaistos.core.utils.paths import private_directory

FOLLOW_INTERVAL = 0.5  # seconds between looking for new records

type Record = dict[str, object]  # as written: `at`, `level`, `message`, …
LevelName = Literal["debug", "info", "warning", "error", "critical"]
ProcessName = Literal["cli", "daemon"]

# Fields every record has, shown in fixed places as text; the rest follow as `key=value`.
_FIXED = frozenset({"at", "level", "process", "pid", "logger", "message", "error", "stack"})
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


def json_text(record: Mapping[str, object]) -> str:
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
                private_directory(self.directory)
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


@dataclass(frozen=True)
class Setup:
    """How a process logs: into which directory, as which process, from which level."""

    directory: Path
    process: str  # `cli` or `daemon`
    level: int
    shown: bool = False  # also on stderr, as text


_log = logging.getLogger(__name__)
_installed: list[logging.Handler] = []
_active: Setup | None = None


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


def start(setup: Setup) -> DayFileHandler:
    """Sends all records at the setup's level and above to the log, also uncaught exceptions.

    Replaces what an earlier `start` set up. Returns the handler writing the log files, whose
    `failure` tells if writing them failed.
    """
    global _active  # noqa: PLW0603 - one setup per process, as for the settings
    stop()
    written = DayFileHandler(setup.directory, setup.process)
    handlers: list[logging.Handler] = [written]
    if setup.shown:
        shown = logging.StreamHandler(sys.stderr)
        shown.setFormatter(TextFormatter(setup.process))
        handlers.append(shown)
    root = logging.getLogger()
    root.setLevel(setup.level)
    for handler in handlers:
        root.addHandler(handler)
        _installed.append(handler)
    sys.excepthook = _log_uncaught
    threading.excepthook = _log_uncaught_in_thread
    _active = setup
    return written


def active() -> Setup | None:
    """How this process logs, as `start` set it up; None if it doesn't."""
    return _active


def stop() -> None:
    """Undoes `start`."""
    global _active  # noqa: PLW0603
    _active = None
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


def _field_text(value: object) -> str:
    """A field's value: strings as they are, anything else as JSON."""
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)


def record_text(record: Record, *, dated: bool = False, brief: bool = False) -> str:
    """A record as one line in local time, with its traceback (if any) indented below.

    E.g. `14:03:21.123 INFO  cli[4242] recorded clone.moved event=… subject=…`; `dated` puts
    the date in front (`2026-10-08 14:03:21.123`), `brief` shortens a traceback to its last line.
    """
    at = record_at(record).astimezone()
    seconds = f"{at:%Y-%m-%d %H:%M:%S}" if dated else f"{at:%H:%M:%S}"
    parts = [
        f"{seconds}.{at.microsecond // 1000:03d}",
        f"{record['level']!s:<5}",
        f"{record.get('process', '?')}[{record.get('pid', '?')}]",
        str(record["message"]),
        *(f"{key}={_field_text(value)}" for key, value in record.items() if key not in _FIXED),
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


_POSITION = re.compile(r"(\d{4}-\d{2}-\d{2}):(\d+)")


@dataclass(frozen=True, order=True)
class Position:
    """Where a record's line starts: its day's file and the byte there, e.g. `2026-10-14:18734`.

    Files are only appended to, so a position stays the same record's until its day is deleted.
    """

    day: date
    offset: int

    @override
    def __str__(self) -> str:
        return f"{self.day.isoformat()}:{self.offset}"

    @classmethod
    def parse(cls, text: str) -> Self:
        """A position as `str` writes it; raises ValueError if it isn't one."""
        if match := _POSITION.fullmatch(text):
            try:
                return cls(date.fromisoformat(match[1]), int(match[2]))
            except ValueError:
                pass  # not a day, e.g. 2026-13-01
        raise ValueError(f"{text!r} is not a position like 2026-10-14:18734")


class Entry(NamedTuple):
    """A record and where it is."""

    position: Position
    record: Record


@dataclass(frozen=True)
class Reading:
    """The entries read, newest first, and where to follow on from."""

    entries: list[Entry]
    skipped: int  # lines that aren't records
    today: date
    offset: int  # in today's file, after its last complete line


def _lines(data: bytes) -> Iterator[tuple[int, bytes]]:
    """The lines in `data`, each with the offset it starts at."""
    start = 0
    for line in data.split(b"\n"):
        yield start, line
        start += len(line) + 1


def read(
    directory: Path,
    selection: Selection,
    limit: int = 0,
    *,
    before: Position | None = None,
    today: date | None = None,
) -> Reading:
    """The newest `limit` selected records (0: all), newest first: as written, backwards.

    `before` pages back: only records written before that position. The last line of today's
    file is left out unless complete: it may still be written.
    """
    today = today or datetime.now(UTC).date()
    offset = 0
    skipped = 0
    entries: list[Entry] = []
    for day, path in reversed(day_files(directory)):
        if not selection.covers(day) or (before is not None and day > before.day):
            continue
        data = path.read_bytes()
        if day == today:
            data = data[: data.rfind(b"\n") + 1]
            offset = len(data)
        if before is not None and day == before.day:
            data = data[: before.offset]
        found: list[Entry] = []
        for start, line in _lines(data):
            record = parsed(line)
            if record is None:
                skipped += bool(line.strip())
            elif selection.matches(record):
                found.append(Entry(Position(day, start), record))
        entries += reversed(found)
        if limit and len(entries) >= limit:
            break
    return Reading(entries[:limit] if limit else entries, skipped, today, offset)


def follow(
    directory: Path,
    selection: Selection,
    after: Reading,
    *,
    today: Callable[[], date] = lambda: datetime.now(UTC).date(),
    sleep: Callable[[float], None] = time.sleep,
) -> Iterator[Entry]:
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
        lines = list(_lines(pending + chunk))
        start = offset - len(pending)
        offset += len(chunk)
        *complete, (_, pending) = lines
        for at, line in complete:
            if (record := parsed(line)) is not None and selection.matches(record):
                yield Entry(Position(day, start + at), record)
        if not chunk and (current := today()) != day:
            day, offset, pending = current, 0, b""
            continue
        sleep(FOLLOW_INTERVAL)
