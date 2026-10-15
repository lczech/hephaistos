"""The Server's guard: lets requests and live connections through only with the token.

A client sends the token as `Authorization: Bearer <token>`, and only so: a cookie would also
go to every other port on localhost, and a URL ends up in logs. A live connection, which can't
carry headers from a browser, sends it as its first message. Both must name this Machine as
`localhost` or `127.0.0.1`, so that no other site's name can be pointed at it (DNS rebinding).
The guard counts and logs what the app answers.
"""

import logging
import time
import urllib.parse
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime

from fastapi import Request, Response, WebSocket
from fastapi.responses import JSONResponse
from starlette.requests import HTTPConnection

from hephaistos.core.db.sessions import read_session
from hephaistos.core.registry import machines
from hephaistos.core.utils.paths import Paths
from hephaistos.daemon.server import web
from hephaistos.daemon.server.token import TokenFile, matches

HOSTS = frozenset({"localhost", "127.0.0.1"})
HIDDEN = frozenset({"token"})  # query parameters never logged, however spelt

log = logging.getLogger(__name__)

type CallNext = Callable[[Request], Awaitable[Response]]


@dataclass
class Counts:
    """The requests the Server answered and refused, and its live connections open."""

    requests: int = 0
    refused: int = 0
    last_request_at: datetime | None = None
    live: int = 0


def shown_request(request: Request) -> str:
    """A request's method and path as logged: with its query decoded, but never a token."""
    pairs = urllib.parse.parse_qsl(request.url.query, keep_blank_values=True)
    query = "&".join(
        f"{name}={'…' if name.strip().lower() in HIDDEN else value}" for name, value in pairs
    )
    return f"{request.method} {request.url.path}{f'?{query}' if query else ''}"


def _hostname(connection: HTTPConnection) -> str:
    """The host a request or live connection names, without the port."""
    host = connection.headers.get("host", "")
    return host.rpartition(":")[0] if ":" in host else host


def _foreign_host(connection: HTTPConnection) -> str | None:
    """Why a request or live connection is refused for the host it names; None if it isn't."""
    if (host := _hostname(connection)) not in HOSTS:
        return f"this Server answers only to localhost, not to {host}"
    return None


def _wrong_token(given: str | None, token: str) -> str | None:
    """Why a token given is refused; None if it is the token."""
    if not given:
        return "no token; see `hephaistos daemon token`"
    if not matches(given, token):
        return "wrong token; see `hephaistos daemon token`"
    return None


def _given_token(request: Request) -> str | None:
    """The token in a request's Authorization header."""
    scheme, _, credentials = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() == "bearer" and credentials.strip():
        return credentials.strip()
    return None


def _refused(reason: str, status: int) -> Response:
    """The answer to a refused request."""
    headers = {"WWW-Authenticate": "Bearer"} if status == 401 else None  # noqa: PLR2004 - HTTP's
    return JSONResponse({"error": reason}, status_code=status, headers=headers)


def _secured(response: Response) -> Response:
    """A response with the headers that keep the GUI's page to itself."""
    response.headers.update(web.HEADERS)
    return response


class Guard:
    """Lets requests and live connections through with the token, counting and logging them."""

    def __init__(self, paths: Paths, counts: Counts) -> None:
        """Checks requests against the token in `paths`, counting them in `counts`."""
        self._tokens = TokenFile(paths)
        self._counts = counts
        with read_session(paths) as session:
            self._machine = machines.this(session).name

    def token(self) -> str:
        """The token now."""
        return self._tokens.current()

    def _refusal(self, request: Request, token: str) -> tuple[str, int] | None:
        """Why a request is refused, and with which status; None if it isn't."""
        if (foreign := _foreign_host(request)) is not None:
            return foreign, 400
        if web.is_open(request.url.path):
            return None
        if (wrong := _wrong_token(_given_token(request), token)) is not None:
            return wrong, 401
        return None

    def socket_refusal(self, websocket: WebSocket) -> str | None:
        """Why a live connection is refused before its token; None if it isn't.

        Browsers let any page open WebSockets to any host, so a browser's (with an `Origin`)
        must come from this Server's own page; other clients send none.
        """
        if (foreign := _foreign_host(websocket)) is not None:
            return foreign
        origin = websocket.headers.get("origin")
        if origin is not None and origin != f"http://{websocket.headers.get('host')}":
            return f"only this Server's own page may connect, not {origin}"
        return None

    def token_refusal(self, given: str) -> str | None:
        """Why a live connection is refused for the token it gave; None if it isn't."""
        return _wrong_token(given, self.token())

    def refused(self, shown: str, client: str, reason: str) -> None:
        """Counts and logs a refusal."""
        self._counts.refused += 1
        log.warning("refused %s from %s: %s", shown, client, reason)

    def admitted(self) -> None:
        """Counts what was let through."""
        self._counts.requests += 1
        self._counts.last_request_at = datetime.now(UTC)

    async def __call__(self, request: Request, call_next: CallNext) -> Response:
        """Answers a request: refused, or by the app."""
        started = time.monotonic()
        shown = shown_request(request)
        token = self._tokens.current()
        if (refusal := self._refusal(request, token)) is not None:
            reason, status = refusal
            self.refused(shown, request.client.host if request.client else "?", reason)
            return _secured(_refused(reason, status))
        try:
            response = await call_next(request)
        except Exception:
            log.exception("failed: %s", shown)
            error = f"internal error; see the log on {self._machine}"
            response = JSONResponse({"error": error}, status_code=500)
        self.admitted()
        milliseconds = round((time.monotonic() - started) * 1000)
        log.debug("%s %d %d ms", shown, response.status_code, milliseconds)
        return _secured(response)
