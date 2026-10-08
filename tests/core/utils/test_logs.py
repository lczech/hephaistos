import json
import logging
import subprocess
import sys
import threading
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest

from hephaistos.core.utils import logs


def _record(message: str, at: datetime | None = None, **fields: object) -> logging.LogRecord:
    record = logging.makeLogRecord({"name": "hephaistos.test", "msg": message, **fields})
    record.levelname = "INFO"
    if at is not None:
        record.created = at.timestamp()
    return record


def _lines(path: Path) -> list[dict[str, object]]:
    return [json.loads(line) for line in path.read_text().splitlines()]


def test_records_are_json_lines(tmp_path: Path) -> None:
    handler = logs.DayFileHandler(tmp_path / "logs", "cli")
    at = datetime(2026, 10, 8, 12, 0, 0, 123000, tzinfo=UTC)
    handler.emit(_record("recorded %s", at, args=("clone.moved",), event=Path("/x"), count=2))
    try:
        raise ValueError("a bug")  # noqa: TRY301 - for a real traceback
    except ValueError:
        handler.emit(_record("failed\nbadly", at, exc_info=sys.exc_info()))

    path = tmp_path / "logs" / "2026-10-08.jsonl"
    assert len(path.read_text().splitlines()) == 2
    first, second = _lines(path)
    assert first == {
        "at": "2026-10-08T12:00:00.123Z",
        "level": "INFO",
        "process": "cli",
        "pid": first["pid"],
        "logger": "hephaistos.test",
        "message": "recorded clone.moved",
        "event": "/x",
        "count": 2,
    }
    assert second["message"] == "failed\nbadly"
    error = str(second["error"])
    assert error.startswith("Traceback (most recent call last):")
    assert error.endswith("ValueError: a bug")


def test_undecodable_text_stays_one_valid_line(tmp_path: Path) -> None:
    handler = logs.DayFileHandler(tmp_path, "cli")
    name = b"caf\xe9".decode(errors="surrogateescape")
    handler.emit(_record("observed %s", args=(name,)))
    [path] = [path for _, path in logs.day_files(tmp_path)]
    [line] = _lines(path)
    assert line["message"] == f"observed {name}"
    assert handler.failure is None


def test_records_go_to_the_file_of_their_utc_day(tmp_path: Path) -> None:
    handler = logs.DayFileHandler(tmp_path, "cli")
    late = datetime(2026, 10, 8, 23, 59, 59, tzinfo=UTC)
    for at in (late, late + timedelta(seconds=2), late + timedelta(days=1)):
        handler.emit(_record("tick", at))
    assert [(day, len(_lines(path))) for day, path in logs.day_files(tmp_path)] == [
        (date(2026, 10, 8), 1),
        (date(2026, 10, 9), 2),
    ]


def test_first_record_of_a_day_deletes_files_past_retention(tmp_path: Path) -> None:
    today = date(2026, 10, 8)
    for days in (31, 30, 1):
        logs.day_file(tmp_path, today - timedelta(days=days)).write_text("{}\n")
    (tmp_path / "notes.txt").write_text("not a log")
    handler = logs.DayFileHandler(tmp_path, "cli", retention_days=30)
    handler.emit(_record("first", datetime(2026, 10, 8, 9, tzinfo=UTC)))
    assert [day for day, _ in logs.day_files(tmp_path)] == [
        date(2026, 9, 8),
        date(2026, 10, 7),
        today,
    ]
    assert (tmp_path / "notes.txt").exists()


def test_a_day_already_begun_deletes_nothing(tmp_path: Path) -> None:
    today = date(2026, 10, 8)
    old = logs.day_file(tmp_path, today - timedelta(days=40))
    old.write_text("{}\n")
    logs.day_file(tmp_path, today).write_text("{}\n")  # another process wrote today
    logs.DayFileHandler(tmp_path, "cli").emit(_record("later", datetime(2026, 10, 8, tzinfo=UTC)))
    assert old.exists()


def test_failure_ends_writing_quietly(tmp_path: Path) -> None:
    blocked = tmp_path / "blocked"
    blocked.write_text("a file where the directory should be")
    handler = logs.DayFileHandler(blocked / "logs", "cli")
    handler.emit(_record("lost"))
    assert isinstance(handler.failure, OSError)
    handler.emit(_record("also lost"))


@pytest.mark.parametrize(
    ("value", "level"),
    [(None, logging.INFO), ("debug", logging.DEBUG), ("WARNING", logging.WARNING), ("x", 20)],
)
def test_level_from(value: str | None, level: int) -> None:
    env = {} if value is None else {logs.LEVEL_VARIABLE: value}
    assert logs.level_from(env) == level


def _fail() -> None:
    raise ZeroDivisionError


def test_start_logs_uncaught_exceptions_in_threads(tmp_path: Path) -> None:
    handler = logs.DayFileHandler(tmp_path, "daemon")
    logs.start([handler], logging.INFO)
    try:
        thread = threading.Thread(target=_fail, name="observer")
        thread.start()
        thread.join()
    finally:
        logs.stop()
    [path] = [path for _, path in logs.day_files(tmp_path)]
    [line] = _lines(path)
    assert line["level"] == "CRITICAL"
    assert line["message"] == "uncaught ZeroDivisionError in observer"
    assert "ZeroDivisionError" in str(line["error"])
    assert logging.getLogger().handlers.count(handler) == 0


WRITER = """
import logging, sys
from pathlib import Path
from hephaistos.core.utils import logs
logs.start([logs.DayFileHandler(Path(sys.argv[1]), "cli")], logging.INFO)
for number in range(300):
    logging.getLogger("hephaistos.test").info("record %d", number, extra={"pad": "x" * 2000})
"""


def test_processes_appending_at_once_keep_every_record_whole(tmp_path: Path) -> None:
    writers = [subprocess.Popen([sys.executable, "-c", WRITER, str(tmp_path)]) for _ in range(4)]
    assert [writer.wait() for writer in writers] == [0] * 4
    lines = [line for _, path in logs.day_files(tmp_path) for line in _lines(path)]
    assert len(lines) == 4 * 300
    assert len({(line["pid"], line["message"]) for line in lines}) == 4 * 300
