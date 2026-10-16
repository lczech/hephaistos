import asyncio
import logging
import shutil
import sys
import threading
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, get_args

import pytest
from fastapi.testclient import TestClient
from starlette.testclient import WebSocketTestSession
from starlette.websockets import WebSocketDisconnect

from hephaistos.core.db.sessions import ReadSession, write_session
from hephaistos.core.registry import machines
from hephaistos.core.utils import logs
from hephaistos.core.utils.paths import Paths
from hephaistos.daemon import status
from hephaistos.daemon.errors import PartError
from hephaistos.daemon.server import api, live, token
from hephaistos.daemon.server.app import create_app
from hephaistos.daemon.server.guard import Counts
from hephaistos.daemon.server.server import Server
from hephaistos.daemon.status import PassStatus, ServerStatus, Status
from support import FakeWatcher, openapi

ORIGIN = "http://127.0.0.1:8264"
LIVE = "ws://127.0.0.1:8264/api/live"  # in full: the test client's sockets ignore its base URL


@pytest.fixture(autouse=True)
def laptop(paths: Paths) -> None:
    machines.set_up(paths, "laptop")


@pytest.fixture(autouse=True)
def quick(monkeypatch: pytest.MonkeyPatch) -> None:
    """Looks often, but beats rarely, so that a test sees the messages it waits for."""
    monkeypatch.setattr(live, "INTERVAL", 0.02)
    monkeypatch.setattr(live, "HEARTBEAT", 60.0)


@pytest.fixture
def looked(monkeypatch: pytest.MonkeyPatch) -> threading.Event:
    """Set once the live loop has looked, after which it hints at any write."""
    event = threading.Event()
    changes = live.Looker.changes

    def changes_and_tell(self: live.Looker, *, check: bool = False) -> list[live.Hint]:
        hints = changes(self, check=check)
        event.set()
        return hints

    monkeypatch.setattr(live.Looker, "changes", changes_and_tell)
    return event


@pytest.fixture
def counts() -> Counts:
    return Counts()


@pytest.fixture
def client(paths: Paths, counts: Counts) -> Iterator[TestClient]:
    """A client of the Server, kept open so that its event loop lasts between messages."""
    app = create_app(paths, counts, "0.1.0", FakeWatcher().observe, None)
    headers = {"Authorization": f"Bearer {token.token(paths)}"}
    with TestClient(app, base_url=ORIGIN, headers=headers) as client:
        yield client


def _connect(client: TestClient, **headers: str) -> WebSocketTestSession:
    return client.websocket_connect(LIVE, headers={"Origin": ORIGIN, **headers})


def _admitted(socket: WebSocketTestSession, paths: Paths, looked: threading.Event) -> None:
    """Sends the token, then waits for the live loop's first look: writes before it don't count."""
    socket.send_json({"token": token.token(paths)})
    assert looked.wait(10), "the live loop didn't look"


def _write(paths: Paths) -> None:
    """Commits a write session, as any command that changes data does."""
    with write_session(paths) as session:
        session.tick()


def _status(*, requests: int = 0, finished: datetime | None = None) -> Status:
    started = datetime(2026, 10, 15, 9, tzinfo=UTC)
    done = None if finished is None else PassStatus(finished, 0.2)
    server = ServerStatus("127.0.0.1:8264", listening=True, requests=requests)
    return Status(1, "0.1.0", started, parts=("watcher", "server"), watcher=done, server=server)


def _hints_until(socket: WebSocketTestSession, wanted: str) -> list[Any]:
    """The messages received until one hints `wanted`."""
    received: list[Any] = []
    while not received or wanted not in received[-1].get("hints", []):
        received.append(socket.receive_json())
    return received


# What changes are found


def test_hints_at_writes_to_the_database(paths: Paths) -> None:
    looker = live.Looker(paths)
    assert looker.changes() == []  # the first look only looks
    assert looker.changes() == []
    _write(paths)
    assert looker.changes() == ["data"]
    assert looker.changes(check=True) == []
    looker.close()


def test_opens_a_replaced_database_again(paths: Paths) -> None:
    looker = live.Looker(paths)
    looker.changes()
    copy = paths.database.with_name("copy")
    shutil.copy(paths.database, copy)
    copy.replace(paths.database)
    assert looker.changes() == ["data"]
    _write(paths)
    assert looker.changes() == ["data"]
    looker.close()


def test_hints_at_a_change_that_went_unnoticed(
    paths: Paths, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(ReadSession, "data_version", property(lambda _: 1))
    looker = live.Looker(paths)
    looker.changes()
    _write(paths)
    assert looker.changes() == []  # missed
    assert looker.changes(check=True) == ["data"]
    assert "a change to the database went unnoticed" in caplog.text
    assert looker.changes(check=True) == []
    looker.close()


def test_hints_at_the_log_growing(paths: Paths) -> None:
    looker = live.Looker(paths)
    looker.changes()
    today = logs.day_file(paths.state_dir, datetime.now(UTC).date())
    today.parent.mkdir(parents=True, exist_ok=True)
    today.write_text("{}\n")
    assert looker.changes() == ["log"]
    with today.open("a") as file:
        file.write("{}\n")
    assert looker.changes() == ["log"]
    assert looker.changes() == []
    looker.close()


def test_hints_at_the_daemon_but_not_at_its_counts(paths: Paths) -> None:
    status.write(paths.state_dir, _status())
    looker = live.Looker(paths)
    looker.changes()
    status.write(paths.state_dir, _status(requests=5))
    assert looker.changes() == []  # a hint would bring another request, and so on
    status.write(paths.state_dir, _status(requests=6, finished=datetime.now(UTC)))
    assert looker.changes() == ["daemon"]
    looker.close()


def test_hints_at_the_watcher_stalling(paths: Paths) -> None:
    finished = datetime.now(UTC) - timedelta(days=1)
    looker = live.Looker(paths)
    looker.changes()
    status.write(paths.state_dir, _status(finished=finished))
    assert looker.changes() == ["daemon"]
    assert looker.changes() == []  # stalled, as it was a moment ago


def test_every_hint_has_a_detector(paths: Paths) -> None:
    assert list(live.Looker(paths).detectors()) == list(get_args(live.Hint))


def test_every_endpoint_says_what_keeps_it_current(paths: Paths) -> None:
    endpoints = {path for path, methods in openapi(paths)["paths"].items() if "get" in methods}
    assert set(api.KEPT_CURRENT) == endpoints


# Live connections


def test_hints_at_changes(
    client: TestClient, paths: Paths, counts: Counts, looked: threading.Event
) -> None:
    with _connect(client) as socket:
        _admitted(socket, paths, looked)
        _write(paths)
        assert _hints_until(socket, "data")[-1] == {"hints": ["data"]}
        assert counts.live == 1
    assert (counts.requests, counts.live) == (1, 0)


def test_beats(client: TestClient, paths: Paths, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(live, "HEARTBEAT", 0.05)
    with _connect(client) as socket:
        socket.send_json({"token": token.token(paths)})
        message = socket.receive_json()
        while "heartbeat" not in message:
            message = socket.receive_json()
        assert datetime.fromisoformat(message["heartbeat"]) <= datetime.now(UTC)


def test_a_pass_asked_for_hints_at_once(
    client: TestClient, paths: Paths, monkeypatch: pytest.MonkeyPatch, looked: threading.Event
) -> None:
    monkeypatch.setattr(live, "INTERVAL", 60.0)
    with _connect(client) as socket:
        _admitted(socket, paths, looked)
        _write(paths)
        assert client.post("/api/observe").status_code == 204
        assert _hints_until(socket, "data")[-1] == {"hints": ["data"]}


@pytest.mark.parametrize(
    ("first", "reason"),
    [
        ({"token": "nope"}, "wrong token; see `hephaistos daemon token`"),
        ({"hello": "there"}, "no token; see `hephaistos daemon token`"),
        ("not JSON", "no token; see `hephaistos daemon token`"),
    ],
)
def test_needs_the_token_first(
    client: TestClient,
    counts: Counts,
    caplog: pytest.LogCaptureFixture,
    first: object,
    reason: str,
) -> None:
    with _connect(client) as socket:
        if isinstance(first, str):
            socket.send_text(first)
        else:
            socket.send_json(first)
        with pytest.raises(WebSocketDisconnect) as closed:
            socket.receive_json()
    assert (closed.value.code, closed.value.reason) == (live.REFUSED, reason)
    assert (counts.refused, counts.requests, counts.live) == (1, 0, 0)
    assert f"refused live connection from testclient: {reason}" in caplog.text


def test_needs_the_token_in_time(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(live, "TOKEN_TIME", 0.05)
    with _connect(client) as socket, pytest.raises(WebSocketDisconnect) as closed:
        socket.receive_json()
    assert closed.value.code == live.REFUSED


@pytest.mark.parametrize(
    ("headers", "reason"),
    [
        ({"Origin": "https://evil.example"}, "only this Server's own page may connect"),
        ({"Host": "evil.example:8264"}, "answers only to localhost, not to evil.example"),
    ],
)
def test_refuses_other_pages_and_hosts(
    client: TestClient,
    counts: Counts,
    caplog: pytest.LogCaptureFixture,
    headers: dict[str, str],
    reason: str,
) -> None:
    with pytest.raises(WebSocketDisconnect) as closed, _connect(client, **headers):
        pass
    assert closed.value.code == live.REFUSED
    assert counts.refused == 1
    assert reason in caplog.text


def test_clients_without_a_page_may_connect(
    client: TestClient, paths: Paths, looked: threading.Event
) -> None:
    with client.websocket_connect(LIVE) as socket:
        _admitted(socket, paths, looked)
        _write(paths)
        _hints_until(socket, "data")


def _until_closed(socket: WebSocketTestSession) -> WebSocketDisconnect:
    """How the Server closes the connection, after any messages before."""
    while True:
        try:
            socket.receive_json()
        except WebSocketDisconnect as closed:
            return closed


def test_renewing_the_token_closes_connections(
    client: TestClient, paths: Paths, looked: threading.Event
) -> None:
    with _connect(client) as socket:
        _admitted(socket, paths, looked)
        token.renew(paths)
        closed = _until_closed(socket)
    assert closed.code == live.REFUSED
    assert "renewed" in closed.reason


def test_closes_a_client_that_falls_behind(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.WARNING)
    behind = live.Client("127.0.0.1", "token")
    for _ in range(live.BEHIND + 2):
        behind.send(live.LiveHintsJson(hints=["data"]))
    assert behind.queue.qsize() == live.BEHIND + 1  # and then the close
    assert "closed a live connection from 127.0.0.1" in caplog.text


def test_the_schema_describes_the_messages(paths: Paths) -> None:
    schemas = openapi(paths)["components"]["schemas"]
    assert schemas["LiveHintsJson"]["properties"]["hints"]["items"]["enum"] == [
        "data",
        "daemon",
        "log",
    ]
    assert {"LiveTokenJson", "LiveHeartbeatJson"} <= set(schemas)


def test_shows_live_connections_in_the_status(tmp_path: Path) -> None:
    server = ServerStatus("127.0.0.1:8264", listening=True, live=2)
    status.write(tmp_path, Status(1, "0.1.0", datetime.now(UTC), server=server))
    found = status.read(tmp_path)
    assert found is not None
    assert found.server is not None
    assert found.server.live == 2


def test_the_server_needs_the_websocket_library(
    paths: Paths, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setitem(sys.modules, "websockets", None)  # as if not installed
    reported: list[ServerStatus] = []
    server = Server(paths, "0.1.0", reported.append, FakeWatcher().observe)
    with pytest.raises(PartError, match="the websockets package is missing"):
        asyncio.run(server.run())
    assert reported[-1].error is not None
    assert "websockets" in reported[-1].error
