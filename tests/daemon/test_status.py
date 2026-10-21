import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from hephaistos.daemon import status
from hephaistos.daemon.errors import NotStartedError
from hephaistos.daemon.status import PassStatus, ServerStatus, Status

STARTED = datetime(2026, 10, 10, 6, 0, tzinfo=UTC)
LATER = STARTED + timedelta(minutes=2)
WRITTEN = Status(
    41233,
    "0.1.0",
    STARTED,
    parts=("watcher", "server"),
    watcher=PassStatus(STARTED, 0.4, "the worker died"),
    server=ServerStatus("127.0.0.1:8264", listening=True, requests=3, last_request_at=LATER),
)


def test_written_and_read(tmp_path: Path) -> None:
    status.write(tmp_path, WRITTEN)
    assert status.read(tmp_path) == WRITTEN
    assert WRITTEN.last_seen_at == LATER
    assert [path.name for path in tmp_path.iterdir()] == [status.STATUS_NAME]


@pytest.mark.parametrize("text", [None, "", "[]", '{"pid": 1}', "not json"])
def test_unreadable_is_none(tmp_path: Path, text: str | None) -> None:
    if text is not None:
        (tmp_path / status.STATUS_NAME).write_text(text)
    assert status.read(tmp_path) is None


@pytest.mark.parametrize(
    ("part", "field", "value"),
    [
        (None, "pid", True),
        (None, "parts", "watcher"),
        ("watcher", "trigger", "timer"),
        ("watcher", "duration", "0.4"),
        ("server", "listening", "false"),
        ("server", "requests", 3.0),
    ],
)
def test_values_of_another_type_are_unreadable(
    tmp_path: Path, part: str | None, field: str, value: object
) -> None:
    status.write(tmp_path, WRITTEN)
    path = tmp_path / status.STATUS_NAME
    data = json.loads(path.read_text())
    (data if part is None else data[part])[field] = value
    path.write_text(json.dumps(data))
    assert status.read(tmp_path) is None


def test_lock_held_once(tmp_path: Path) -> None:
    status.write(tmp_path, Status(41233, "0.1.0", datetime.now(UTC)))
    message = r"already running on this Machine \(pid 41233\)"
    with status.held_lock(tmp_path), pytest.raises(NotStartedError, match=message):  # noqa: SIM117
        with status.held_lock(tmp_path):
            pass
    with status.held_lock(tmp_path):  # released
        pass
