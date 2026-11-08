import subprocess
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from hephaistos.core.db import raw
from hephaistos.core.db.sessions import read_session
from hephaistos.core.db.tables import Table
from hephaistos.core.observers import terminals as observer
from hephaistos.core.registry import machines
from hephaistos.core.state import terminals
from hephaistos.core.state.terminals import TerminalStatus
from hephaistos.core.terminals.tmux import ID_OPTION, TmuxKeeper
from hephaistos.core.utils.paths import Paths
from hephaistos.daemon.watcher import worker

pytestmark = pytest.mark.tmux


@pytest.fixture
def set_up(paths: Paths) -> Paths:
    machines.set_up(paths, "laptop")
    return paths


@pytest.fixture
def boot(tmp_path: Path) -> Path:
    """A stand-in for the boot ID's file, so that tests can reboot."""
    path = tmp_path / "boot_id"
    path.write_text("boot-1\n")
    return path


def tmux(keeper: TmuxKeeper, *args: str) -> str:
    """Runs tmux on the Keeper's socket as a user would; returns its output."""
    command = [keeper.binary, "-L", keeper.socket, "-f", "/dev/null", *args]
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    assert result.returncode == 0, f"tmux {args[0]} failed: {result.stderr}"
    return result.stdout


def by_hand(keeper: TmuxKeeper, name: str, directory: Path) -> None:
    tmux(keeper, "new-session", "-d", "-s", name, "-c", str(directory))


def observe(paths: Paths, keeper: TmuxKeeper, boot: Path) -> observer.Result:
    return observer.observe(paths, keeper, boot_file=boot)


def stored(paths: Paths) -> dict[str, terminals.TerminalState]:
    with read_session(paths) as session:
        return {state.name: state for state in terminals.on_this_machine(session)}


def tmux_ids(keeper: TmuxKeeper) -> dict[str, uuid.UUID | None]:
    return {session.name: session.terminal_id for session in keeper.sessions()}


def test_sessions_made_by_hand_are_adopted(
    set_up: Paths, keeper: TmuxKeeper, boot: Path, tmp_path: Path
) -> None:
    by_hand(keeper, "mine", tmp_path)
    result = observe(set_up, keeper, boot)
    assert result.changes is not None
    assert (result.changes.open, result.changes.added) == (1, 1)
    state = stored(set_up)["mine"]
    assert (state.status, state.directory, state.boot_id) == ("open", tmp_path, "boot-1")
    assert tmux_ids(keeper) == {"mine": state.id}


def test_created_then_ended(set_up: Paths, keeper: TmuxKeeper, boot: Path, tmp_path: Path) -> None:
    created = keeper.create(uuid.uuid4(), "api", tmp_path, None, {})
    keeper.create(uuid.uuid4(), "web", tmp_path, None, {})
    observe(set_up, keeper, boot)
    assert stored(set_up)["api"].id == created.terminal_id
    keeper.kill("api")
    result = observe(set_up, keeper, boot)
    assert result.changes is not None
    assert result.changes.ended == 1
    assert list(stored(set_up)) == ["web"]


def test_lost_when_the_server_dies(
    set_up: Paths, keeper: TmuxKeeper, boot: Path, tmp_path: Path
) -> None:
    keeper.create(uuid.uuid4(), "api", tmp_path, None, {})
    observe(set_up, keeper, boot)
    tmux(keeper, "kill-server")
    observe(set_up, keeper, boot)
    assert stored(set_up)["api"].status is TerminalStatus.LOST


def test_lost_after_a_reboot(set_up: Paths, keeper: TmuxKeeper, boot: Path, tmp_path: Path) -> None:
    keeper.create(uuid.uuid4(), "api", tmp_path, None, {})
    keeper.create(uuid.uuid4(), "web", tmp_path, None, {})
    observe(set_up, keeper, boot)
    keeper.kill("api")  # as if the server had come back after the reboot, without it
    boot.write_text("boot-2\n")
    observe(set_up, keeper, boot)
    assert {name: state.status for name, state in stored(set_up).items()} == {
        "api": "lost",
        "web": "open",
    }
    assert stored(set_up)["web"].boot_id == "boot-2"


def test_one_made_by_hand_brings_a_lost_one_back(
    set_up: Paths, keeper: TmuxKeeper, boot: Path, tmp_path: Path
) -> None:
    created = keeper.create(uuid.uuid4(), "api", tmp_path, None, {})
    observe(set_up, keeper, boot)
    tmux(keeper, "kill-server")
    observe(set_up, keeper, boot)
    by_hand(keeper, "api", tmp_path)
    observe(set_up, keeper, boot)
    state = stored(set_up)["api"]
    assert (state.id, state.status) == (created.terminal_id, "open")
    assert tmux_ids(keeper) == {"api": created.terminal_id}


def test_a_copied_id_is_replaced(
    set_up: Paths, keeper: TmuxKeeper, boot: Path, tmp_path: Path
) -> None:
    created = keeper.create(uuid.uuid4(), "api", tmp_path, None, {})
    observe(set_up, keeper, boot)
    by_hand(keeper, "copy", tmp_path)
    tmux(keeper, "set-option", "-t", "=copy:", ID_OPTION, str(created.terminal_id))
    observe(set_up, keeper, boot)
    ids = tmux_ids(keeper)
    assert ids["api"] == created.terminal_id
    assert ids["copy"] not in (None, created.terminal_id)
    assert {name: state.id for name, state in stored(set_up).items()} == ids


def test_odd_names_by_hand(set_up: Paths, keeper: TmuxKeeper, boot: Path, tmp_path: Path) -> None:
    for name in ("x y", "ünï-😀", "-lead"):
        by_hand(keeper, name, tmp_path)
    observe(set_up, keeper, boot)
    assert sorted(stored(set_up)) == sorted(["x y", "ünï-😀", "-lead"])


def test_observers_at_once_adopt_once(
    set_up: Paths, keeper: TmuxKeeper, boot: Path, tmp_path: Path
) -> None:
    for name in ("a", "b", "c"):
        by_hand(keeper, name, tmp_path)

    def once(_: int) -> observer.Result:
        return observe(set_up, keeper, boot)

    with ThreadPoolExecutor(5) as pool:
        list(pool.map(once, range(5)))
    script = (
        "from hephaistos.core.observers import terminals;"
        "from hephaistos.core.utils.paths import Paths;"
        "terminals.observe(Paths.from_environment())"
    )
    for name in ("d", "e"):
        by_hand(keeper, name, tmp_path)
    processes = [subprocess.Popen([sys.executable, "-c", script]) for _ in range(4)]
    assert [process.wait(timeout=30) for process in processes] == [0] * 4
    observe(set_up, keeper, boot)
    ids = tmux_ids(keeper)
    assert len(set(ids.values())) == 5
    assert {name: state.id for name, state in stored(set_up).items()} == ids


def test_without_tmux(set_up: Paths, keeper: TmuxKeeper, boot: Path, tmp_path: Path) -> None:
    missing = TmuxKeeper(
        binary=str(tmp_path / "no-tmux"),
        socket=keeper.socket,
        config_file=keeper.config_file,
        history=10,
        detect_scopes=lambda: None,
    )
    assert observe(set_up, missing, boot) == observer.Result(None)  # no Terminals: no news
    keeper.create(uuid.uuid4(), "api", tmp_path, None, {})
    observe(set_up, keeper, boot)
    before = stored(set_up)
    result = observe(set_up, missing, boot)
    assert result.changes is None
    assert result.error is not None
    assert "tmux is not installed" in result.error
    assert stored(set_up) == before


def test_the_boot_id(tmp_path: Path) -> None:
    assert observer.boot_id(tmp_path / "missing") == observer.UNKNOWN_BOOT
    if observer.BOOT_ID.exists():
        assert observer.boot_id() == observer.BOOT_ID.read_text().strip()


def test_the_watchers_pass(set_up: Paths, keeper: TmuxKeeper, tmp_path: Path) -> None:
    by_hand(keeper, "mine", tmp_path)
    done = worker.observed(set_up)
    assert isinstance(done, worker.Done)
    assert done.terminals == 1
    assert list(stored(set_up)) == ["mine"]


def test_raw_listing(set_up: Paths, keeper: TmuxKeeper, boot: Path, tmp_path: Path) -> None:
    keeper.create(uuid.uuid4(), "api", tmp_path, ["sleep", "60"], {})
    observe(set_up, keeper, boot)
    with read_session(set_up) as session:
        listed = raw.rows(session, Table.STATE_TERMINALS.value)
    [values] = listed.values
    row = dict(zip(listed.columns, values, strict=True))
    types = dict(zip(listed.columns, listed.types, strict=True))
    assert (row["name"], row["status"], row["directory"]) == ("api", "open", str(tmp_path))
    assert row["command"] is None  # only creating through the Core knows it
    assert isinstance(row["id"], uuid.UUID)
    assert (types["id"], types["started_at"], types["observed_at"]) == ("id", "time", "clock")
