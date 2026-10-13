"""The Server's web app: the API, for clients with the token, and the GUI's files.

A client sends the token as `Authorization: Bearer <token>`, and only so: a cookie would also
go to every other port on localhost, and a URL ends up in logs. Requests must name this
Machine as `localhost` or `127.0.0.1`, so that no other site's name can be pointed at it (DNS
rebinding). The app logs what it answers.
"""

import logging
import time
import urllib.parse
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from hephaistos.core.db.sessions import read_session
from hephaistos.core.registry import machines
from hephaistos.core.serialize import API_VERSION
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.paths import Paths
from hephaistos.daemon.server import api, web
from hephaistos.daemon.server.api import Observe
from hephaistos.daemon.server.token import TokenFile, matches

HOSTS = frozenset({"localhost", "127.0.0.1"})
HIDDEN = frozenset({"token"})  # query parameters never logged, however spelt

log = logging.getLogger(__name__)

type CallNext = Callable[[Request], Awaitable[Response]]


@dataclass
class Counts:
    """The requests the Server answered and refused."""

    requests: int = 0
    refused: int = 0
    last_request_at: datetime | None = None


def shown_request(request: Request) -> str:
    """A request's method and path as logged: with its query decoded, but never a token."""
    pairs = urllib.parse.parse_qsl(request.url.query, keep_blank_values=True)
    query = "&".join(
        f"{name}={'…' if name.strip().lower() in HIDDEN else value}" for name, value in pairs
    )
    return f"{request.method} {request.url.path}{f'?{query}' if query else ''}"


def _hostname(request: Request) -> str:
    """The host the request names, without the port."""
    host = request.headers.get("host", "")
    return host.rpartition(":")[0] if ":" in host else host


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
    """Lets requests through with the token, counting and logging what the app answers."""

    def __init__(self, paths: Paths, counts: Counts) -> None:
        """Checks requests against the token in `paths`, counting them in `counts`."""
        self._tokens = TokenFile(paths)
        self._counts = counts
        with read_session(paths) as session:
            self._machine = machines.this(session).name

    def _refusal(self, request: Request, token: str) -> tuple[str, int] | None:
        """Why a request is refused, and with which status; None if it isn't."""
        if (host := _hostname(request)) not in HOSTS:
            return f"this Server answers only to localhost, not to {host}", 400
        if web.is_open(request.url.path):
            return None
        if (given := _given_token(request)) is None:
            return "no token; see `hephaistos daemon token`", 401
        if not matches(given, token):
            return "wrong token; see `hephaistos daemon token`", 401
        return None

    async def __call__(self, request: Request, call_next: CallNext) -> Response:
        """Answers a request: refused, or by the app."""
        started = time.monotonic()
        shown = shown_request(request)
        token = self._tokens.current()
        if (refusal := self._refusal(request, token)) is not None:
            reason, status = refusal
            self._counts.refused += 1
            client = request.client.host if request.client else "?"
            log.warning("refused %s from %s: %s", shown, client, reason)
            return _secured(_refused(reason, status))
        try:
            response = await call_next(request)
        except Exception:
            log.exception("failed: %s", shown)
            error = f"internal error; see the log on {self._machine}"
            response = JSONResponse({"error": error}, status_code=500)
        self._counts.requests += 1
        self._counts.last_request_at = datetime.now(UTC)
        milliseconds = round((time.monotonic() - started) * 1000)
        log.debug("%s %d %d ms", shown, response.status_code, milliseconds)
        return _secured(response)


async def _http_error(_: Request, error: Exception) -> Response:
    """An error the app or its routing raised on purpose, e.g. 404."""
    if not isinstance(error, HTTPException):
        raise error
    return JSONResponse({"error": error.detail}, status_code=error.status_code)


async def _invalid_request(_: Request, error: Exception) -> Response:
    """Parameters that don't fit, e.g. an ID that isn't one."""
    if not isinstance(error, RequestValidationError):
        raise error
    problems = [
        f"{' '.join(str(part) for part in problem['loc'])}: {problem['msg']}"
        for problem in error.errors()
    ]
    return JSONResponse({"error": "; ".join(problems)}, status_code=400)


async def _refused_by_core(_: Request, error: Exception) -> Response:
    """What the Core refuses, with the message the CLI would print."""
    return JSONResponse({"error": str(error)}, status_code=400)


def create_app(
    paths: Paths, counts: Counts, version: str, observe: Observe, gui: Path | None
) -> FastAPI:
    """The Server's app for this Machine, counting its requests in `counts`.

    `observe` has the Watcher run a pass; `gui` holds the GUI's built files, if there are any.
    """
    app = FastAPI(
        title="hephaistos",
        version=f"{API_VERSION.major}.{API_VERSION.minor}",
        summary="This Machine's Server: what the CLI's `--json` shows, for GUIs.",
        docs_url=None,  # its pages run scripts from a CDN, which would see the token
        redoc_url=None,
    )
    app.state.paths = paths
    app.state.version = version
    app.state.observe = observe
    app.state.gui = gui
    app.middleware("http")(Guard(paths, counts))
    app.add_exception_handler(HTTPException, _http_error)
    app.add_exception_handler(RequestValidationError, _invalid_request)
    app.add_exception_handler(HephaistosError, _refused_by_core)
    app.include_router(api.router)
    app.include_router(web.router)
    return app
