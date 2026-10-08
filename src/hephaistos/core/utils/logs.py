"""Log files: diagnostics about hephaistos itself, local to this Machine, never synced.

One JSON record per line, one file per UTC day. Several processes append to the same file:
each record is one write on an O_APPEND descriptor, so records don't interleave on local
filesystems. Files are never rewritten; the first record of a day deletes the old ones.
"""

import json
import logging
import os
import re
import sys
import threading
from collections.abc import Mapping
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from types import TracebackType
from typing import override

LOG_LEVEL = logging.INFO
RETENTION_DAYS = 30
LEVEL_VARIABLE = "HEPHAISTOS_LOG_LEVEL"

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
    found = [
        (date.fromisoformat(match[1]), path)
        for path in paths
        if (match := _DAY_FILE.fullmatch(path.name))
    ]
    return sorted(found)


def delete_older(directory: Path, day: date) -> list[Path]:
    """Deletes the log files of the days before `day`; returns them."""
    deleted: list[Path] = []
    for older, path in day_files(directory):
        if older < day:
            path.unlink(missing_ok=True)
            deleted.append(path)
    return deleted


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
        return json.dumps(self.fields(record), ensure_ascii=False, default=str)


class DayFileHandler(logging.Handler):
    """Appends records to the file of their UTC day, deleting files past retention.

    Logging is best effort: the first failure is kept in `failure` and ends writing.
    """

    def __init__(self, directory: Path, process: str, retention_days: int = RETENTION_DAYS) -> None:
        """Writes into `directory`, created when needed."""
        super().__init__()
        self.directory = directory
        self.retention_days = retention_days
        self.failure: OSError | None = None
        self._day: date | None = None
        self.setFormatter(JsonFormatter(process))

    @override
    def emit(self, record: logging.LogRecord) -> None:
        if self.failure is not None:
            return
        try:
            # Lone surrogates (undecodable file names) become JSON escapes, not errors.
            line = (self.format(record) + "\n").encode(errors="backslashreplace")
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
                delete_older(self.directory, day - timedelta(days=self.retention_days))
        except OSError as error:
            self.failure = error


def level_from(env: Mapping[str, str] = os.environ) -> int:
    """The level set by HEPHAISTOS_LOG_LEVEL (e.g. `debug`), else LOG_LEVEL; invalid ones too."""
    name = env.get(LEVEL_VARIABLE, "").upper()
    return logging.getLevelNamesMapping().get(name, LOG_LEVEL)


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
