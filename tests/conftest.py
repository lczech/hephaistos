import os
import subprocess
from collections.abc import Iterator
from pathlib import Path

import pytest

from hephaistos.core import config
from hephaistos.core.registry import machines
from hephaistos.core.terminals.tmux import TmuxKeeper
from hephaistos.core.utils import commit_graph, scopes
from hephaistos.core.utils.paths import PATH_VARIABLES, Paths
from hephaistos.desktop import apparmor
from support import hostnamectl

# Typer reads this when it first formats output: plain text, even where GITHUB_ACTIONS or
# FORCE_COLOR would colour usage errors and help.
os.environ["_TYPER_FORCE_DISABLE_TERMINAL"] = "1"

#: The D-Bus of the user, as the tests found it: for the `systemd_keeper` tests alone.
USER_BUS = os.environ.get("DBUS_SESSION_BUS_ADDRESS")
NO_BUS = "unix:path=/nonexistent/hephaistos-tests/bus"


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
    """systemctl and loginctl fail, there is no graphical session, and the AppArmor files are
    temporary ones: `setup` and others never reach the services, desktop or system of the user.
    The `systemd` fixture stands in for systemd.

    Nor does tmux reach the D-Bus of the user. tmux built with systemd support, as Ubuntu's,
    asks the user manager for a scope for each pane; for a pane whose program ends at once, as
    many in the tests do, that scope stays, empty and active, until the user logs out: a
    thousand of them after a few runs.
    """
    for name in ("DISPLAY", "WAYLAND_DISPLAY", *PATH_VARIABLES[1:]):  # all but our HOME
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("DBUS_SESSION_BUS_ADDRESS", NO_BUS)
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
def commit_graphs_settled() -> Iterator[None]:
    """No commit-graph file a test asked for is still being written in the next."""
    yield
    commit_graph.settle()


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


def kill_server(keeper: TmuxKeeper) -> None:
    """Ends the tmux server of `keeper`, if one runs, and removes its socket, which tmux leaves."""
    subprocess.run(
        [keeper.binary, "-L", keeper.socket, "kill-server"], capture_output=True, check=False
    )
    keeper.socket_path.unlink(missing_ok=True)


@pytest.fixture
def keeper(paths: Paths) -> Iterator[TmuxKeeper]:
    """A Keeper on a socket of this test alone (its HEPHAISTOS_HOME gives it one), without systemd
    (systemctl fails in the tests); its server ended afterwards."""
    found = TmuxKeeper.from_settings(paths)
    yield found
    kill_server(found)


@pytest.fixture
def systemd_keeper(paths: Paths, monkeypatch: pytest.MonkeyPatch) -> Iterator[TmuxKeeper]:
    """A Keeper with the real systemd user manager; skips the test where there is none."""
    fake = Path(os.environ["PATH"].split(os.pathsep)[0])  # the systemctl of the tests, which fails
    assert (fake / "systemctl").exists()
    monkeypatch.setenv("PATH", os.environ["PATH"].removeprefix(f"{fake}{os.pathsep}"))
    if USER_BUS is None:
        monkeypatch.delenv("DBUS_SESSION_BUS_ADDRESS")
    else:
        monkeypatch.setenv("DBUS_SESSION_BUS_ADDRESS", USER_BUS)
    if scopes.detect() is None:
        pytest.skip("needs the systemd user manager")
    found = TmuxKeeper.from_settings(paths)
    yield found
    kill_server(found)
