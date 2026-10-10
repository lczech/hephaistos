from datetime import UTC, datetime
from pathlib import Path

import pytest

from hephaistos.daemon import status
from hephaistos.daemon.errors import NotStartedError
from hephaistos.daemon.status import PassStatus, Status


def test_written_and_read(tmp_path: Path) -> None:
    started = datetime(2026, 10, 10, 6, 0, tzinfo=UTC)
    written = Status(
        41233,
        "0.1.0",
        started,
        parts={"watcher": PassStatus(started, 0.4, "the worker died"), "server": None},
    )
    status.write(tmp_path, written)
    assert status.read(tmp_path) == written
    assert [path.name for path in tmp_path.iterdir()] == [status.STATUS_NAME]


@pytest.mark.parametrize("text", [None, "", "[]", '{"pid": 1}', "not json"])
def test_unreadable_is_none(tmp_path: Path, text: str | None) -> None:
    if text is not None:
        (tmp_path / status.STATUS_NAME).write_text(text)
    assert status.read(tmp_path) is None


def test_lock_held_once(tmp_path: Path) -> None:
    status.write(tmp_path, Status(41233, "0.1.0", datetime.now(UTC)))
    message = r"already running on this Machine \(pid 41233\)"
    with status.held_lock(tmp_path), pytest.raises(NotStartedError, match=message):  # noqa: SIM117
        with status.held_lock(tmp_path):
            pass
    with status.held_lock(tmp_path):  # released
        pass
