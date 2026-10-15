"""The Server's web app: the API, for clients with the token, and the GUI's files."""

from collections.abc import Callable
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import TypeAdapter
from starlette.exceptions import HTTPException

from hephaistos.core.serialize import API_VERSION
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.paths import Paths
from hephaistos.daemon.server import api, live, web
from hephaistos.daemon.server.api import Observe
from hephaistos.daemon.server.guard import Counts, Guard


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
    guard = Guard(paths, counts)
    app.state.live = live.Live(paths, counts, guard)
    app.middleware("http")(guard)
    app.add_exception_handler(HTTPException, _http_error)
    app.add_exception_handler(RequestValidationError, _invalid_request)
    app.add_exception_handler(HephaistosError, _refused_by_core)
    app.include_router(api.router)
    app.add_api_websocket_route("/api/live", app.state.live.serve)
    app.include_router(web.router)
    app.openapi = _with_messages(app.openapi)
    return app


def _with_messages(openapi: Callable[[], dict[str, Any]]) -> Callable[[], dict[str, Any]]:
    """The API's schema with the live connections' messages, which no HTTP endpoint names."""

    def described() -> dict[str, Any]:
        schema = openapi()
        schemas = schema.setdefault("components", {}).setdefault("schemas", {})
        for message in live.MESSAGES:
            found = TypeAdapter(message).json_schema(
                mode="serialization", ref_template="#/components/schemas/{model}"
            )
            schemas.update(found.pop("$defs", {}))
            schemas[message.__name__] = found
        return schema

    return described
