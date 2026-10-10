import contextlib
import json
import os
import signal
import stat
import sys
from collections.abc import Iterator
from pathlib import Path

import pytest

from hephaistos.core.db.sessions import write_session
from hephaistos.core.registry import clones, machines, repositories
from hephaistos.core.utils.paths import Paths
from hephaistos.daemon import unit
from support import clone, create


@pytest.fixture
def repo(paths: Paths, tmp_path: Path) -> Path:
    """A set-up Machine with Clone `repo` of Repository `proj`, cloned from `origin`."""
    machines.set_up(paths, "laptop")
    repo = clone(create(tmp_path / "origin"), tmp_path / "repo")
    candidate = clones.inspect(repo)
    with write_session(paths) as session:
        repositories.add(session, "proj")
        clones.add(session, "proj", candidate)
    return repo


FAKE = Path(__file__).with_name("fake_systemd.py")


def _script(path: Path, text: str) -> Path:
    path.write_text(text)
    path.chmod(path.stat().st_mode | stat.S_IXUSR)
    return path


@pytest.fixture
def systemd(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    """Fake systemctl and loginctl on the PATH, a fresh home for the unit, and a `hephaistos`
    script to install; yields that script. The fake's state is in $FAKE_SYSTEMD."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for name in ("systemctl", "loginctl"):
        _script(bin_dir / name, f"#!{sys.executable}\n{FAKE.read_text()}")
    run = "from hephaistos.cli.main import run; run()"
    program = _script(
        bin_dir / "hephaistos", f"#!/bin/sh\nexec {sys.executable} -c '{run}' \"$@\"\n"
    )
    state = tmp_path / "systemd"
    state.mkdir()
    monkeypatch.setenv("PATH", f"{bin_dir}:{os.environ['PATH']}")
    monkeypatch.setenv("FAKE_SYSTEMD", str(state))
    monkeypatch.setenv("FAKE_LINGER_DIR", str(tmp_path / "linger"))
    monkeypatch.setattr(unit, "LINGER_DIR", tmp_path / "linger")
    monkeypatch.setenv("HOME", str(tmp_path / "user"))
    monkeypatch.setenv("HEPHAISTOS_WATCHER_INTERVAL", "1")
    yield program
    started = state / "state.json"
    if started.exists() and (pid := json.loads(started.read_text())["pid"]):
        with contextlib.suppress(ProcessLookupError):
            os.kill(pid, signal.SIGKILL)
