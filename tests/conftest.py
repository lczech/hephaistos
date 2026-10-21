import os
from collections.abc import Iterator
from pathlib import Path

import pytest

from hephaistos.core import config
from hephaistos.core.registry import machines
from hephaistos.core.utils.paths import PATH_VARIABLES, Paths
from hephaistos.desktop import apparmor
from support import hostnamectl

# Typer reads this when it first formats output: plain text, even where GITHUB_ACTIONS or
# FORCE_COLOR would colour usage errors and help.
os.environ["_TYPER_FORCE_DISABLE_TERMINAL"] = "1"


@pytest.fixture(autouse=True)
def never_real_files(
    tmp_path_factory: pytest.TempPathFactory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Even tests without `paths` keep away from the real config, data, logs and systemd unit."""
    monkeypatch.setenv("HEPHAISTOS_HOME", str(tmp_path_factory.mktemp("home")))
    monkeypatch.setenv("HOME", str(tmp_path_factory.mktemp("user")))
    for key in config.KEYS:
        monkeypatch.delenv(config.variable(key), raising=False)


@pytest.fixture(autouse=True)
def no_systemd_or_desktop(
    tmp_path_factory: pytest.TempPathFactory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """systemctl and loginctl fail, there's no graphical session, and AppArmor's files are
    temporary ones: `setup` and others never reach the user's services, desktop or system. The
    `systemd` fixture stands in for systemd."""
    for name in ("DISPLAY", "WAYLAND_DISPLAY", *PATH_VARIABLES[1:]):  # all but our HOME
        monkeypatch.delenv(name, raising=False)
    bin_dir = tmp_path_factory.mktemp("bin")
    for name in ("systemctl", "loginctl"):
        failing = bin_dir / name
        failing.write_text("#!/bin/sh\nexit 1\n")
        failing.chmod(0o755)
    monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{os.environ['PATH']}")
    system = tmp_path_factory.mktemp("system")
    monkeypatch.setattr(apparmor, "RESTRICTION", system / "apparmor_restrict_unprivileged_userns")
    monkeypatch.setattr(apparmor, "INSTALLED", system / "apparmor.d" / apparmor.NAME)


@pytest.fixture(autouse=True)
def laptop_chassis(monkeypatch: pytest.MonkeyPatch) -> None:
    """systemd, as asked about the chassis, answers as on a laptop; never the real one."""
    monkeypatch.setattr(machines, "hostnamectl", hostnamectl({("chassis",): "laptop"}))


@pytest.fixture(autouse=True)
def default_settings() -> Iterator[None]:
    """Each test starts with the default settings, whatever the one before activated."""
    config.activate(config.DEFAULTS)
    yield
    config.activate(config.DEFAULTS)


@pytest.fixture
def paths(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Paths:
    """Our files in a temporary HEPHAISTOS_HOME, never in the real ones."""
    monkeypatch.setenv("HEPHAISTOS_HOME", str(tmp_path / "home"))
    return Paths.from_environment()


@pytest.fixture(autouse=True)
def isolated_git(tmp_path_factory: pytest.TempPathFactory, monkeypatch: pytest.MonkeyPatch) -> None:
    """git without the user's config, and with a fixed identity for commits."""
    config = tmp_path_factory.mktemp("git") / "config"
    config.touch()
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", str(config))
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    for role in ("AUTHOR", "COMMITTER"):
        monkeypatch.setenv(f"GIT_{role}_NAME", "Test")
        monkeypatch.setenv(f"GIT_{role}_EMAIL", "test@example.com")
