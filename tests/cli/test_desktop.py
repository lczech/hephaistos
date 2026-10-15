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


def _entry() -> Path:
    return Path.home() / ".local" / "share" / "applications" / "hephaistos.desktop"


@pytest.mark.usefixtures("checkout")
def test_install_writes_the_launcher_entry_and_icon(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(apparmor, "needed", lambda: False)
    shown = "~/.local/share/applications/hephaistos.desktop"
    assert runner.invoke(app, ["desktop", "install"]).output == f"Installed: {shown}\n"
    assert _entry().read_text().splitlines()[5].endswith(" desktop open")
    icon = Path.home() / ".local/share/icons/hicolor/scalable/apps/hephaistos.svg"
    assert icon.read_text() == "<svg/>"
    assert runner.invoke(app, ["desktop", "install"]).output == f"Already installed: {shown}\n"
    assert runner.invoke(app, ["desktop", "uninstall"]).output == f"Deleted {shown}\n"
    assert not _entry().exists()
    assert not icon.exists()
    assert runner.invoke(app, ["desktop", "uninstall"]).output == "No launcher entry installed\n"


@pytest.mark.usefixtures("checkout")
def test_the_apparmor_profile_takes_root_only_when_asked(
    paths: Paths, monkeypatch: pytest.MonkeyPatch
) -> None:
    installed = apparmor.INSTALLED
    _restricted(monkeypatch, installed=True)
    lines = runner.invoke(app, ["desktop", "install"]).output.splitlines()
    assert lines[1:] == [f"Already installed: {installed}"]
    _restricted(monkeypatch, installed=False)
    lines = runner.invoke(app, ["desktop", "install"]).output.splitlines()  # no terminal: no sudo
    source = paths.state_dir / "hephaistos-desktop.apparmor"
    assert lines[2:] == [
        f"  sudo install -m 644 {source} {installed}",
        f"  sudo apparmor_parser -r {installed}",
        "Run them, then `hephaistos desktop open`",
    ]
    assert "userns," in source.read_text()
    installed.parent.mkdir()
    installed.touch()
    lines = runner.invoke(app, ["desktop", "uninstall"]).output.splitlines()
    assert lines[1:] == [
        f"Unloading and removing {installed} takes root:",
        f"  sudo apparmor_parser -R {installed}",
        f"  sudo rm {installed}",
        "Run them to remove it",
    ]
