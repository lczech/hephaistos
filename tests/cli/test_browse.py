from collections.abc import Callable
from pathlib import Path

import pytest
from typer.testing import CliRunner

from hephaistos.cli import browse
from hephaistos.cli.main import app
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.paths import Paths

runner = CliRunner()
LINK = "http://127.0.0.1:8264/#token=abc"


def link_of(link: str) -> Callable[[Paths], str]:
    """A stand-in for `server_link`."""

    def server_link(_paths: Paths) -> str:
        return link

    return server_link


def running(*, answer: bool) -> Callable[[Path], bool]:
    """A stand-in for `status.is_running`."""

    def is_running(_directory: Path) -> bool:
        return answer

    return is_running


@pytest.fixture
def opened(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """The links given to the browser; the Daemon runs, with its Server listening."""
    links: list[str] = []

    def open_link(link: str) -> bool:
        links.append(link)
        return True

    monkeypatch.setattr(browse.webbrowser, "open", open_link)
    monkeypatch.setattr(browse.daemon_status, "is_running", running(answer=True))
    monkeypatch.setattr(browse, "server_link", link_of(LINK))
    monkeypatch.setenv("WAYLAND_DISPLAY", "wayland-0")
    return links


def test_opens_the_gui_in_the_browser(opened: list[str]) -> None:
    assert runner.invoke(app, ["browse"]).output == "Opened the GUI in your browser\n"
    assert opened == [LINK]


def test_prints_the_link_without_a_graphical_session(
    opened: list[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("WAYLAND_DISPLAY")
    monkeypatch.delenv("DISPLAY", raising=False)
    shown = runner.invoke(app, ["browse"]).output
    assert shown == f"No graphical session here; open this link in a browser:\n{LINK}\n"
    assert opened == []


@pytest.mark.usefixtures("opened")
def test_starts_the_daemon_and_waits_for_its_server(monkeypatch: pytest.MonkeyPatch) -> None:
    started: list[Paths] = []
    asked: list[int] = []

    def link(_paths: Paths) -> str:
        asked.append(1)
        if len(asked) < 3:  # listening at the third look
            raise HephaistosError("the server isn't running")
        return LINK

    monkeypatch.setattr(browse.daemon_status, "is_running", running(answer=False))
    monkeypatch.setattr(browse.unit, "start", started.append)
    monkeypatch.setattr(browse, "server_link", link)
    monkeypatch.setattr(browse, "POLL", 0.01)
    result = runner.invoke(app, ["browse"])
    assert result.output == "Starting the daemon…\nOpened the GUI in your browser\n"
    assert len(started) == 1
    monkeypatch.setattr(browse, "LISTEN_WAIT", 0.0)
    asked.clear()
    assert str(runner.invoke(app, ["browse"]).exception) == "the server isn't running"
