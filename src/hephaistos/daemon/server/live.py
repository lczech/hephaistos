"""Live connections: a WebSocket per GUI, over which the Server hints at what changed.

Hints carry no data: a GUI asks the API again for what they name. One loop looks for changes
every second while any connection is open, and sends a heartbeat every ten, so that GUIs notice
a Server that hangs. A client that falls behind is closed rather than sent fewer hints, so that
none goes missing: a GUI that reconnects asks again for everything.
"""

import asyncio
import contextlib
import functools
import json
import logging
import sqlite3
import time
from collections.abc import Awaitable, Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from typing import Any, Literal, TypedDict, cast

import anyio
from fastapi import WebSocket, WebSocketDisconnect

from hephaistos.core.db.sessions import ReadSession, read_session
from hephaistos.core.utils import logs
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.ids import Timestamp
from hephaistos.core.utils.paths import Paths
from hephaistos.daemon import report, status
from hephaistos.daemon.server.guard import Counts, Guard

INTERVAL = 1.0  # seconds between looking for changes
HEARTBEAT = 10.0  # seconds between heartbeats
TOKEN_TIME = 5.0  # seconds a client has to send the token
BEHIND = 64  # messages a client may have waiting before it is closed

# Close codes: 4000 and up are ours; 4401 asks the client for a new token, as HTTP's 401 does.
REFUSED = 4401
FELL_BEHIND = 1013  # WebSocket's "try again later"
FAILED = 1011  # WebSocket's "internal error"

log = logging.getLogger(__name__)

Hint = Literal["data", "daemon", "log"]  # what changed: the database, the Daemon, the log


class LiveTokenJson(TypedDict):
    """The first message, from the client: this Machine's token."""

    token: str


class LiveHintsJson(TypedDict):
    """What changed; the client asks the API again for what shows it."""

    hints: list[Hint]


class LiveHeartbeatJson(TypedDict):
    """The Server is alive, at this time."""

    heartbeat: str


type Message = LiveHintsJson | LiveHeartbeatJson

#: The messages, for the API's schema, which describes only what HTTP endpoints use.
MESSAGES = (LiveTokenJson, LiveHintsJson, LiveHeartbeatJson)


@dataclass(frozen=True)
class _Close:
    """Closes the connection, after the messages before it."""

    code: int
    reason: str


class Client:
    """A live connection: the messages waiting to be sent to it."""

    def __init__(self, where: str, token: str) -> None:
        """A client at `where`, admitted with `token`."""
        self.where = where
        self.token = token
        self.queue: asyncio.Queue[Message | _Close] = asyncio.Queue()
        self._closing = False

    def send(self, message: Message) -> None:
        """Queues a message; closes the connection instead if too many are waiting."""
        if self._closing:
            return
        if self.queue.qsize() >= BEHIND:
            log.warning("closed a live connection from %s: %d messages behind", self.where, BEHIND)
            self.close(FELL_BEHIND, "fell behind; reconnect")
            return
        self.queue.put_nowait(message)

    def close(self, code: int, reason: str) -> None:
        """Closes the connection once the messages queued before are sent."""
        if not self._closing:
            self._closing = True
            self.queue.put_nowait(_Close(code, reason))


class Looker:
    """Looks for what changed since it last looked; in one thread only, as SQLite requires."""

    def __init__(self, paths: Paths) -> None:
        """Looks at the database, Daemon status and log in `paths`."""
        self._paths = paths
        self._session: ReadSession | None = None
        self._inode: int | None = None  # the database file's, while open
        self._sessions = contextlib.ExitStack()
        self._failure: str | None = None  # why the database can't be read, once logged
        self._seen: dict[Hint, object] | None = None
        self._hinted_clock: Timestamp | None = None  # the clock when data was last hinted

    def detectors(self) -> dict[Hint, Callable[[], object]]:
        """How each hint's subject looks now; a hint is due when that changes."""
        return {"data": self._data, "daemon": self._daemon, "log": self._log}

    def changes(self, *, check: bool = False) -> list[Hint]:
        """The hints due since last time; none the first time.

        With `check`, also checks that the clock didn't move without a `data` hint, which
        would mean that a change went unnoticed: it is logged, and hinted.
        """
        clock = self._clock() if check else None
        now: dict[Hint, object] = {hint: look() for hint, look in self.detectors().items()}
        seen, self._seen = self._seen, now
        if seen is None:
            self._hinted_clock = self._clock()
            return []
        changed: list[Hint] = [hint for hint, value in now.items() if value != seen[hint]]
        if "data" in changed:
            self._hinted_clock = self._clock()
        elif clock is not None and clock != self._hinted_clock:
            log.warning(
                "a change to the database went unnoticed; hinting it now",
                extra={"clock": clock, "hinted_clock": self._hinted_clock},
            )
            self._hinted_clock = clock
            changed.insert(0, "data")
        return changed

    def _data(self) -> object:
        """The database: which file, and its data version; None if it can't be read.

        A database replaced, e.g. by `setup --reset`, is opened again.
        """
        try:
            inode = self._paths.database.stat().st_ino
            if self._session is not None and self._inode != inode:
                self.close()
            if self._session is None:
                self._session = self._sessions.enter_context(read_session(self._paths))
                self._inode = inode
            found = (inode, self._session.data_version)
        except (OSError, HephaistosError, sqlite3.Error) as error:
            self.close()
            if str(error) != self._failure:
                log.warning("live hints can't read the database: %s", error)
                self._failure = str(error)
            return None
        self._failure = None
        return found

    def _clock(self) -> Timestamp | None:
        """The clock any write session last saved; None if the database can't be read."""
        if self._session is None:
            return None
        try:
            return self._session.clock_value
        except sqlite3.Error:
            return None

    def _daemon(self) -> object:
        """The Daemon's status as the GUI shows it, but for the Server's counts.

        The counts change with every request, so a hint for them would bring the next one.
        """
        found = status.read(self._paths.state_dir)
        if found is None:
            return None
        server = found.server
        if server is not None:
            server = replace(server, requests=0, last_request_at=None, refused=0)
        done = found.watcher
        stalled = "watcher" in found.parts and done is not None and report.is_stalled(done, _now())
        return replace(found, server=server), stalled

    def _log(self) -> object:
        """Today's log file and its size; None while there is none."""
        day = logs.day_file(self._paths.state_dir, _now().date())
        try:
            return day, day.stat().st_size
        except FileNotFoundError:
            return None

    def close(self) -> None:
        """Closes the database."""
        self._sessions.close()
        self._session = None


def _now() -> datetime:
    return datetime.now(UTC)


class Live:
    """The live connections, and the loop that hints at what changed while any are open."""

    def __init__(self, paths: Paths, counts: Counts, guard: Guard) -> None:
        """Hints at changes in `paths`, counting connections in `counts`, admitted by `guard`."""
        self._paths = paths
        self._counts = counts
        self._guard = guard
        self._clients: set[Client] = set()
        self._loop: asyncio.Task[None] | None = None
        self._woken = asyncio.Event()

    def wake(self) -> None:
        """Looks for changes now, e.g. after a pass someone waits for."""
        self._woken.set()

    async def serve(self, websocket: WebSocket) -> None:
        """A live connection: refused, or sent hints and heartbeats until either side closes."""
        where = websocket.client.host if websocket.client else "?"
        if (reason := self._guard.socket_refusal(websocket)) is not None:
            self._guard.refused("live connection", where, reason)
            await websocket.close(REFUSED, reason)  # before accepting: the handshake fails
            return
        await websocket.accept()
        given = await _token(websocket)
        if given is None:
            return  # gone
        if (reason := self._guard.token_refusal(given)) is not None:
            self._guard.refused("live connection", where, reason)
            await websocket.close(REFUSED, reason)
            return
        self._guard.admitted()
        client = self._join(where, given)
        started = time.monotonic()
        log.debug("live connection from %s", where)
        try:
            await _serve(websocket, client)
        finally:
            self._clients.discard(client)
            self._counts.live = len(self._clients)
            duration = round(time.monotonic() - started, 3)
            log.debug("live connection from %s closed", where, extra={"duration": duration})

    def _join(self, where: str, token: str) -> Client:
        """Adds a client, starting the loop if it isn't running."""
        client = Client(where, token)
        self._clients.add(client)
        self._counts.live = len(self._clients)
        if self._loop is None or self._loop.done():
            self._loop = asyncio.create_task(self._run())
        return client

    def _send(self, message: Message) -> None:
        for client in list(self._clients):
            client.send(message)

    def _close_renewed(self) -> None:
        """Closes the connections admitted with a token that was renewed since."""
        current = self._guard.token()
        for client in list(self._clients):
            if client.token != current:
                client.close(REFUSED, "the token was renewed; see `hephaistos daemon token`")

    async def _run(self) -> None:
        """Hints at changes while any client is connected; on failure, closes them all."""
        loop = asyncio.get_running_loop()
        looker = Looker(self._paths)
        with ThreadPoolExecutor(1, thread_name_prefix="live") as thread:
            try:
                await loop.run_in_executor(thread, looker.changes)
                next_heartbeat = time.monotonic() + HEARTBEAT
                while self._clients:
                    with contextlib.suppress(TimeoutError):
                        await asyncio.wait_for(self._woken.wait(), INTERVAL)
                    self._woken.clear()  # before looking, so that a wake meanwhile counts
                    beat = time.monotonic() >= next_heartbeat
                    look = functools.partial(looker.changes, check=beat)
                    hints = await loop.run_in_executor(thread, look)
                    self._close_renewed()
                    if hints:
                        self._send(LiveHintsJson(hints=hints))
                    if beat:
                        self._send(LiveHeartbeatJson(heartbeat=_now().isoformat()))
                        next_heartbeat = time.monotonic() + HEARTBEAT
            except Exception:
                log.exception("live hints failed")
                for client in list(self._clients):
                    client.close(FAILED, "live hints failed; see the log")
            finally:
                await loop.run_in_executor(thread, looker.close)


async def _token(websocket: WebSocket) -> str | None:
    """The token the first message gives; "" if it gives none in time; None if the client left."""
    try:
        async with asyncio.timeout(TOKEN_TIME):
            text = await websocket.receive_text()
    except TimeoutError:
        return ""
    except WebSocketDisconnect:
        return None
    except (KeyError, RuntimeError):  # binary, not text
        return ""
    try:
        message = json.loads(text)
    except ValueError:
        return ""
    given = cast("dict[str, Any]", message).get("token") if isinstance(message, dict) else None
    return given if isinstance(given, str) else ""


async def _serve(websocket: WebSocket, client: Client) -> None:
    """Sends the client's messages until either side closes."""
    async with anyio.create_task_group() as group:

        async def until_done(work: Callable[[], Awaitable[None]]) -> None:
            await work()
            group.cancel_scope.cancel()

        group.start_soon(until_done, lambda: _send_queued(websocket, client))
        group.start_soon(until_done, lambda: _until_gone(websocket))


async def _send_queued(websocket: WebSocket, client: Client) -> None:
    """Sends what is queued, until a close or the client is gone."""
    with contextlib.suppress(WebSocketDisconnect):
        while True:
            message = await client.queue.get()
            if isinstance(message, _Close):
                await websocket.close(message.code, message.reason)
                return
            await websocket.send_text(json.dumps(message))


async def _until_gone(websocket: WebSocket) -> None:
    """Receives until the client leaves; what it sends after the token means nothing."""
    while (await websocket.receive())["type"] != "websocket.disconnect":
        pass
