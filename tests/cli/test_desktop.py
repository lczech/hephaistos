from pathlib import Path

import pytest
from typer.testing import CliRunner

from hephaistos.cli import desktop
from hephaistos.cli.main import app
from hephaistos.core.utils.paths import Paths
from hephaistos.desktop import apparmor, launch
from support import desktop_checkout

runner = CliRunner()


@pytest.fixture
def checkout(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """hephaistos runs from a checkout whose Desktop is open already."""
    found = desktop_checkout(tmp_path, "exit 0")
    monkeypatch.setattr(desktop, "own_checkout", lambda: found)
    monkeypatch.setattr(launch, "STARTUP", 0.5)
    return found


def _restricted(monkeypatch: pytest.MonkeyPatch, *, installed: bool) -> None:
    def is_installed(_electron: Path) -> bool:
        return installed

    monkeypatch.setattr(apparmor, "needed", lambda: True)
    monkeypatch.setattr(apparmor, "is_installed", is_installed)


@pytest.mark.usefixtures("checkout")
def test_open(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(apparmor, "needed", lambda: False)
    opened = runner.invoke(app, ["desktop", "open"])
    assert opened.output == "The Desktop was open; it comes to the front\n"
    _restricted(monkeypatch, installed=False)
    refused = runner.invoke(app, ["desktop", "open"])
    assert str(refused.exception) == (
        "Electron's sandbox needs an AppArmor profile on this Machine:"
        " run `hephaistos desktop install`"
    )


@pytest.mark.usefixtures("checkout")
def test_install_shows_the_commands_and_runs_them_only_when_asked(
    paths: Paths, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(apparmor, "needed", lambda: False)
    assert runner.invoke(app, ["desktop", "install"]).output == (
        "This Machine needs no AppArmor profile for the Desktop\n"
    )
    _restricted(monkeypatch, installed=True)
    assert runner.invoke(app, ["desktop", "install"]).output == (
        "Already installed: /etc/apparmor.d/hephaistos-desktop\n"
    )
    _restricted(monkeypatch, installed=False)
    shown = runner.invoke(app, ["desktop", "install"]).output.splitlines()  # no terminal: no sudo
    source = paths.state_dir / "hephaistos-desktop.apparmor"
    assert shown[1:] == [
        f"  sudo install -m 644 {source} /etc/apparmor.d/hephaistos-desktop",
        "  sudo apparmor_parser -r /etc/apparmor.d/hephaistos-desktop",
        "Run them, then `hephaistos desktop open`",
    ]
    assert "userns," in source.read_text()
