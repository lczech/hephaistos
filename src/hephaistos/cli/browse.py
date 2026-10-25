"""`hephaistos browse`: this Machine's GUI in the browser."""

import os
import time
import webbrowser

import typer

from hephaistos.cli.daemon import server_link
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.paths import Paths
from hephaistos.daemon import status as daemon_status
from hephaistos.daemon import unit

LISTEN_WAIT = 10.0  # seconds a started Daemon gets for its Server to listen
POLL = 0.1
SESSION_VARIABLES = ("WAYLAND_DISPLAY", "DISPLAY")  # set in a graphical session


def _started_link(paths: Paths) -> str:
    """The GUI's link, starting the installed Daemon first if it doesn't run."""
    if not daemon_status.is_running(paths.state_dir):
        typer.echo("Starting the daemon…", err=True)
        unit.start(paths)
    deadline = time.monotonic() + LISTEN_WAIT
    while True:
        try:
            return server_link(paths)
        except HephaistosError:
            if time.monotonic() > deadline:
                raise
        time.sleep(POLL)


def browse() -> None:
    """Open the GUI in your browser; starts the daemon if needed.

    Without a graphical session, e.g. over SSH, prints the link instead. The browser gets it on
    its command line, where other users of this machine could read it.
    """
    link = _started_link(Paths.from_environment())
    if not any(os.environ.get(name) for name in SESSION_VARIABLES):
        typer.echo(f"No graphical session here; open this link in a browser:\n{link}")
        return
    if not webbrowser.open(link):
        typer.echo(f"Found no browser; open this link in one:\n{link}")
        return
    typer.echo("Opened the GUI in your browser")
