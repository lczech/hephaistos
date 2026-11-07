"""What goes wrong around Terminals: tmux stuck or gone midway, the database busy, systemd stuck."""

import logging
import os
import signal
import sqlite3
import subprocess
from collections.abc import Generator
from contextlib import contextmanager
from pathlib import Path

import pytest

from hephaistos.core import config
from hephaistos.core.db import sessions
from hephaistos.core.db.sessions import read_session
from hephaistos.core.observers import terminals as observer
from hephaistos.core.registry import machines
from hephaistos.core.state import terminals
from hephaistos.core.state.terminals import TerminalStatus
from hephaistos.core.terminals import actions
from hephaistos.core.terminals.tmux import TmuxKeeper
from hephaistos.core.utils import scopes
from hephaistos.core.utils.errors import DatabaseBusyError, HephaistosError
from hephaistos.core.utils.paths import Paths

pytestmark = pytest.mark.tmux


@pytest.fixture
def set_up(paths: Paths, keeper: TmuxKeeper) -> Paths:
    del keeper  # its server ended afterwards
    machines.set_up(paths, "laptop")
    return paths


def stored(paths: Paths) -> dict[str, terminals.TerminalState]:
    with read_session(paths) as session:
        return {state.name: state for state in terminals.on_this_machine(session)}


def like(keeper: TmuxKeeper, *, binary: str | None = None, timeout: float = 5.0) -> TmuxKeeper:
    """Another Keeper on the same socket and config, e.g. with a short timeout."""
    return TmuxKeeper(
        binary=binary or keeper.binary,
        socket=keeper.socket,
        config_file=keeper.config_file,
        history=config.settings().terminals.history,
        detect_scopes=lambda: None,
        timeout=timeout,
    )


def script(tmp_path: Path, name: str, text: str) -> Path:
    path = tmp_path / "bin" / name
    path.parent.mkdir(exist_ok=True)
    path.write_text(f"#!/bin/sh\n{text}\n")
    path.chmod(0o755)
    return path


@contextmanager
def paused(keeper: TmuxKeeper) -> Generator[None]:
    """tmux's server stopped, as if hung, then going on."""
    command = [keeper.binary, "-L", keeper.socket, "display-message", "-p", "#{pid}"]
    server = int(subprocess.run(command, capture_output=True, text=True, check=True).stdout)
    assert Path(f"/proc/{server}/comm").read_text().strip() == "tmux: server"
    os.kill(server, signal.SIGSTOP)
    try:
        yield
    finally:
        os.kill(server, signal.SIGCONT)


def test_tmux_hung_during_a_pass(set_up: Paths, keeper: TmuxKeeper, tmp_path: Path) -> None:
    actions.create(set_up, tmp_path, name="api")
    before = stored(set_up)["api"]
    with paused(keeper):
        result = observer.observe(set_up, like(keeper, timeout=0.5))
    assert result == observer.Result(None, "tmux didn't answer within 0.5 s")
    assert stored(set_up)["api"] == before  # as last known, its age showing it
    assert observer.observe(set_up, keeper).changes is not None
    assert stored(set_up)["api"].status is TerminalStatus.OPEN


def test_the_server_ending_right_after_a_create(
    set_up: Paths, keeper: TmuxKeeper, tmp_path: Path
) -> None:
    real = keeper.binary
    ending = script(
        tmp_path,
        "tmux",
        f'"{real}" "$@"; status=$?\n'
        f'case " $* " in *" new-session "*) "{real}" -L {keeper.socket} kill-server ;; esac\n'
        "exit $status",
    )
    with pytest.raises(HephaistosError, match=r"^terminal api was lost at once: tmux's server"):
        actions.create(set_up, tmp_path, name="api", keeper=like(keeper, binary=str(ending)))
    assert stored(set_up) == {}  # never seen open


def test_the_database_busy_right_after_a_create(
    set_up: Paths, keeper: TmuxKeeper, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(sessions, "BUSY_TIMEOUT_MS", 200)
    locker = sqlite3.connect(set_up.database, autocommit=True)
    create = keeper.create

    def create_then_lock(*args: object, **kwargs: object) -> object:
        created = create(*args, **kwargs)  # type: ignore[arg-type]
        locker.execute("BEGIN IMMEDIATE")  # another process writing for long
        return created

    monkeypatch.setattr(keeper, "create", create_then_lock)
    with pytest.raises(DatabaseBusyError):
        actions.create(set_up, tmp_path, name="api", command=["sleep", "60"], keeper=keeper)
    locker.execute("ROLLBACK")
    locker.close()
    monkeypatch.undo()
    observer.observe(set_up, keeper)  # the next observation finds it
    assert stored(set_up)["api"].status is TerminalStatus.OPEN


def test_systemd_stuck_when_creating(
    set_up: Paths,
    keeper: TmuxKeeper,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    stuck = script(tmp_path, "systemctl", "exec sleep 10")
    script(tmp_path, "systemd-run", 'shift 5; exec "$@"')
    monkeypatch.setenv("PATH", f"{stuck.parent}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.setattr(scopes, "TIMEOUT", 0.3)
    with caplog.at_level(logging.WARNING, logger="hephaistos.core.utils.scopes"):
        created = actions.create(set_up, tmp_path, name="api", keeper=keeper)
    assert created.status is TerminalStatus.OPEN  # without a scope of its own
    assert keeper.scopes is None
    assert [record.getMessage() for record in caplog.records] == [
        "no systemd scopes: systemctl didn't answer within 0.3 s"
    ]


def test_paths_that_arent_utf8_stop_no_observation(
    set_up: Paths, keeper: TmuxKeeper, tmp_path: Path
) -> None:
    odd = tmp_path / os.fsdecode(b"x\xffy")
    odd.mkdir()
    command = [keeper.binary, "-L", keeper.socket, "new-session", "-d", "-s", "mine", "-c"]
    subprocess.run([*command, str(odd), "sleep 600"], check=True)  # by hand, there
    assert observer.observe(set_up, keeper).changes is not None
    assert stored(set_up)["mine"].directory == tmp_path / "x\ufffdy"
