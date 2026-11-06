import os
import subprocess
from collections.abc import Iterator
from pathlib import Path

import pytest

from hephaistos.core.terminals.tmux import TmuxKeeper
from hephaistos.core.utils import scopes
from hephaistos.core.utils.paths import Paths


def kill_server(keeper: TmuxKeeper) -> None:
    """Ends the keeper's tmux server, if one runs, and removes its socket, which tmux leaves."""
    subprocess.run(
        [keeper.binary, "-L", keeper.socket, "kill-server"], capture_output=True, check=False
    )
    directory = Path(os.environ.get("TMUX_TMPDIR") or "/tmp") / f"tmux-{os.getuid()}"  # noqa: S108 - tmux's own default
    (directory / keeper.socket).unlink(missing_ok=True)


@pytest.fixture
def keeper(paths: Paths) -> Iterator[TmuxKeeper]:
    """A Keeper on this test's own socket (its HEPHAISTOS_HOME gives it one), without systemd
    (the tests' systemctl fails); its server ended afterwards."""
    found = TmuxKeeper.from_settings(paths)
    yield found
    kill_server(found)


@pytest.fixture
def systemd_keeper(paths: Paths, monkeypatch: pytest.MonkeyPatch) -> Iterator[TmuxKeeper]:
    """A Keeper with the real systemd user manager; skips the test where there is none."""
    fake = Path(os.environ["PATH"].split(os.pathsep)[0])  # the tests' failing systemctl
    assert (fake / "systemctl").exists()
    monkeypatch.setenv("PATH", os.environ["PATH"].removeprefix(f"{fake}{os.pathsep}"))
    if scopes.detect() is None:
        pytest.skip("needs systemd's user manager")
    found = TmuxKeeper.from_settings(paths)
    yield found
    kill_server(found)
