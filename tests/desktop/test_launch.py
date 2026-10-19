import os
from pathlib import Path

import pytest

from hephaistos.core.utils.paths import Paths
from hephaistos.desktop import launch
from support import desktop_checkout

NPM = "uv run npm --prefix gui"


def test_found_in_a_checkout_or_says_how_to_make_it(tmp_path: Path) -> None:
    with pytest.raises(launch.DesktopError, match="doesn't run from a checkout"):
        launch.find(None)
    bare = desktop_checkout(tmp_path, None)
    with pytest.raises(launch.DesktopError) as missing:
        launch.find(bare)
    assert str(missing.value) == (
        f"Electron isn't installed: `cd {bare} && {NPM} ci && {NPM} run fetch-electron`"
    )
    unbuilt = desktop_checkout(tmp_path / "other", "true", built=False)
    with pytest.raises(launch.DesktopError, match=f"isn't built: `cd .* && {NPM} run build`"):
        launch.find(unbuilt)
    assert launch.find(desktop_checkout(tmp_path / "ready", "true")).checkout.name == "checkout"


def test_its_environment_names_hephaistos_its_profile_and_the_token(paths: Paths) -> None:
    env = {"HOME": "/home/me", "ELECTRON_RUN_AS_NODE": "1"}
    made = launch.environment(env, paths, Path("/bin/hephaistos"))
    assert made == {
        "HOME": "/home/me",
        "HEPHAISTOS_EXECUTABLE": "/bin/hephaistos",
        "HEPHAISTOS_DESKTOP_PROFILE": str(paths.state_dir / "desktop"),
        "HEPHAISTOS_TOKEN_FILE": str(paths.data_dir / "server.token"),
    }
    assert (paths.state_dir / "desktop").stat().st_mode & 0o777 == 0o700


@pytest.fixture
def quick(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(launch, "STARTUP", 0.5)


@pytest.mark.usefixtures("quick")
def test_opening_starts_electron_apart_from_this_process(paths: Paths, tmp_path: Path) -> None:
    marker = tmp_path / "started"
    script = f'echo "$1 $HEPHAISTOS_TOKEN_FILE" > {marker}; exec sleep 30'
    desktop = launch.find(desktop_checkout(tmp_path, script))
    pid = launch.open_desktop(desktop, paths, Path("/bin/hephaistos"), os.environ)
    try:
        assert pid is not None
        assert os.getsid(pid) == pid
        assert marker.read_text().split() == [
            str(desktop.checkout / "gui"),
            str(paths.data_dir / "server.token"),
        ]
    finally:
        if pid is not None:
            os.kill(pid, 15)
            os.waitpid(pid, 0)


@pytest.mark.usefixtures("quick")
def test_an_open_desktop_comes_to_the_front(paths: Paths, tmp_path: Path) -> None:
    desktop = launch.find(desktop_checkout(tmp_path, "exit 0"))
    assert launch.open_desktop(desktop, paths, Path("/bin/hephaistos"), os.environ) is None


@pytest.mark.usefixtures("quick")
def test_says_why_electron_ended_at_start(paths: Paths, tmp_path: Path) -> None:
    script = "echo 'FATAL: The SUID sandbox helper binary was found' >&2; exit 133"
    desktop = launch.find(desktop_checkout(tmp_path, script))
    with pytest.raises(launch.DesktopError) as ended:
        launch.open_desktop(desktop, paths, Path("/bin/hephaistos"), os.environ)
    assert str(ended.value).splitlines() == [
        f"the Desktop exited on start (exit code 133); in {paths.state_dir / 'desktop.log'}:",
        "FATAL: The SUID sandbox helper binary was found",
    ]
