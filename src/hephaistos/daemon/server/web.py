"""The GUI's files, built from `gui/web/`: open to any client, as they hold no data.

The page keeps the token, so it may run only our own files and connect only to this Server.
"""

import html
from pathlib import Path
from typing import cast

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse, HTMLResponse

from hephaistos.core.utils.paths import own_checkout, shell_path

SOURCE = Path("gui", "web")  # in the checkout
BUILD = SOURCE / "dist"
ASSETS = "assets"  # files named by their content, so browsers may keep them for good

POLICY = (  # what the page may load and where it may connect: only this Server
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:;"
    " connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
)
HEADERS = {
    "Content-Security-Policy": POLICY,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
}
KEPT = "public, max-age=31536000, immutable"
CHECKED = "no-cache"  # kept, but asked for again each time

router = APIRouter(include_in_schema=False)


def build() -> Path | None:
    """Where the GUI's built files are, when running from a checkout."""
    checkout = own_checkout()
    return None if checkout is None else checkout / BUILD


def is_open(path: str) -> bool:
    """Whether a request's path is one of the GUI's files, which need no token."""
    return path == "/" or path.startswith(f"/{ASSETS}/")


def _build(request: Request) -> Path | None:
    """The built files this app serves."""
    return cast("Path | None", request.app.state.gui)


def _file(request: Request, name: str, cache: str) -> FileResponse:
    """A file of the build, by its path in it."""
    if (built := _build(request)) is not None:
        path = (built / name).resolve()
        if path.is_relative_to(built.resolve()) and path.is_file():
            return FileResponse(path, headers={"Cache-Control": cache})
    raise HTTPException(404, f"no file {name}")


def _not_built(built: Path | None) -> HTMLResponse:
    """The page shown without a build: how to make one."""
    if built is None:
        text = "This hephaistos doesn't run from a checkout, so it has no GUI yet."
    else:
        checkout = html.escape(shell_path(built.parents[len(BUILD.parts) - 1]))
        npm = f"uv run npm --prefix {SOURCE}"  # uv finds our Node only in the checkout
        text = (
            f"The GUI isn't built yet: <code>cd {checkout} &amp;&amp; {npm} ci &amp;&amp;"
            f" {npm} run build</code>, then reload."
        )
    page = f"<!doctype html><title>hephaistos</title><p>{text}</p>\n"
    return HTMLResponse(page, status_code=503, headers={"Cache-Control": CHECKED})


@router.get("/")
def index(request: Request) -> Response:
    """The GUI's page, or how to build it."""
    built = _build(request)
    if built is None or not (built / "index.html").is_file():
        return _not_built(built)
    return _file(request, "index.html", CHECKED)


@router.get(f"/{ASSETS}/{{name:path}}")
def asset(request: Request, name: str) -> FileResponse:
    """A script, style or image the page loads."""
    return _file(request, f"{ASSETS}/{name}", KEPT)
