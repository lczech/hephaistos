"""The Server: serves the app on 127.0.0.1 at `server.port`, in the Daemon's own process.

With port 0 it takes a free port, which `daemon.json` tells; the Server reports where it listens
only once it does, so nobody is sent to a port that isn't ours.

Its endpoints only read the database, briefly, in uvicorn's threads; git runs in the Watcher's
worker, so the Server answers at normal priority. Asked to observe, it awaits the Watcher's pass.
"""

import asyncio
import errno
import importlib
import logging
import os
import socket
from collections.abc import Callable, Generator
from contextlib import contextmanager
from typing import override

import uvicorn

from hephaistos.core import config
from hephaistos.core.utils.paths import Paths
from hephaistos.daemon.errors import PartError
from hephaistos.daemon.server import ports, token, web
from hephaistos.daemon.server.api import Observe
from hephaistos.daemon.server.app import create_app
from hephaistos.daemon.server.guard import Counts
from hephaistos.daemon.status import ServerStatus

HOST = "127.0.0.1"  # never other interfaces: SSH or Tailscale reach it from elsewhere
REPORT_INTERVAL = 2.0  # seconds between writing the counts to the status file, if changed

log = logging.getLogger(__name__)


class _Uvicorn(uvicorn.Server):
    """uvicorn, leaving signals to the Daemon, which stops it by cancelling."""

    @override
    @contextmanager
    def capture_signals(self) -> Generator[None]:
        yield


def _check_websockets() -> None:
    """Raises PartError without the WebSocket library.

    uvicorn would only warn, and answer live connections as plain requests.
    """
    try:
        importlib.import_module("websockets")
    except ImportError:
        raise PartError(
            "the websockets package is missing; reinstall hephaistos with its dependencies"
        ) from None


def address(port: int) -> str:
    """Where the Server listens."""
    return f"{HOST}:{port}"


def bind(port: int) -> socket.socket:
    """A socket bound to our address; raises PartError if it can't be."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.bind((HOST, port))
    except OSError as error:
        sock.close()
        if error.errno != errno.EADDRINUSE:
            raise PartError(f"can't listen on {address(port)}: {error.strerror}") from None
        held_by = ports.holder(port)
        if held_by is not None and held_by != os.getuid():
            raise PartError(
                f"port {port} is held by another user (uid {held_by}); set server.port for"
                " this host, and renew the token (`hephaistos daemon token --renew`) if a client"
                " may have sent it there"
            ) from None
        raise PartError(f"port {port} is in use; set server.port for this host") from None
    return sock


class Server:
    """Serves the API until cancelled; its counts last across restarts."""

    name = "server"

    def __init__(
        self,
        paths: Paths,
        version: str,
        report: Callable[[ServerStatus], None],
        observe: Observe,
    ) -> None:
        """Serves the data in `paths`, as hephaistos `version`, reporting to `report`.

        `observe` has the Watcher run a pass.
        """
        self._paths = paths
        self._version = version
        self._report = report
        self._observe = observe
        self._counts = Counts()

    def _status(self, where: str, *, listening: bool, error: str | None = None) -> ServerStatus:
        """How the Server is doing now."""
        counts = self._counts
        return ServerStatus(
            where,
            listening=listening,
            error=error,
            requests=counts.requests,
            last_request_at=counts.last_request_at,
            refused=counts.refused,
            live=counts.live,
        )

    async def _keep_reporting(self, where: str) -> None:
        """Reports the counts while they change."""
        reported = None
        while True:
            now = self._status(where, listening=True)
            if now != reported:
                self._report(now)
                reported = now
            await asyncio.sleep(REPORT_INTERVAL)

    async def run(self) -> None:
        """Serves until cancelled; raises PartError if it can't listen."""
        port = config.settings().server.port
        where = address(port)
        token.token(self._paths)
        if token.tighten(self._paths):
            log.warning("others could read %s; now only you can", token.token_file(self._paths))
        try:
            _check_websockets()
            sock = bind(port)
        except PartError as error:
            self._report(self._status(where, listening=False, error=str(error)))
            raise
        where = address(sock.getsockname()[1])  # the free one taken, with port 0
        app = create_app(self._paths, self._counts, self._version, self._observe, web.build())
        logging.getLogger("uvicorn").setLevel(logging.WARNING)  # we log what it would say
        server = _Uvicorn(
            uvicorn.Config(
                app,
                ws="websockets-sansio",
                log_config=None,
                access_log=False,
                lifespan="off",
                server_header=False,
            )
        )
        reporting = asyncio.create_task(self._keep_reporting(where))
        log.info("listening on %s", where)
        try:
            await server.serve(sockets=[sock])
        finally:
            reporting.cancel()
            sock.close()

    def kill(self) -> None:
        """Nothing to kill: the Server runs no processes of its own."""
