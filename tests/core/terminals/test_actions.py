import logging
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from hephaistos.core.db.sessions import read_session
from hephaistos.core.registry import machines
from hephaistos.core.state import terminals
from hephaistos.core.state.terminals import NoSuchTerminalError, TerminalStatus
from hephaistos.core.terminals import actions
from hephaistos.core.terminals.tmux import TmuxKeeper
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.paths import Paths

pytestmark = pytest.mark.tmux


@pytest.fixture
def set_up(paths: Paths, keeper: TmuxKeeper) -> Paths:
    """A Machine whose Keeper is the test's own, its server ended afterwards."""
    del keeper
    machines.set_up(paths, "laptop")
    return paths


@pytest.fixture
def proj(tmp_path: Path) -> Path:
    path = tmp_path / "proj"
    path.mkdir()
    return path


def tmux(keeper: TmuxKeeper, *args: str) -> str:
    command = [keeper.binary, "-L", keeper.socket, "-f", "/dev/null", *args]
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    assert result.returncode == 0, f"tmux {args[0]} failed: {result.stderr}"
    return result.stdout


def stored(paths: Paths) -> dict[str, terminals.TerminalState]:
    with read_session(paths) as session:
        return {state.name: state for state in terminals.on_this_machine(session)}


def lose_all(keeper: TmuxKeeper, paths: Paths) -> None:
    """Kills the server, as a crash would, and observes that."""
    tmux(keeper, "kill-server")
    actions.observer.observe(paths, keeper)


def test_default_names(set_up: Paths, proj: Path) -> None:
    names = [actions.create(set_up, proj).name for _ in range(3)]
    assert names == ["proj-1", "proj-2", "proj-3"]
    assert all(state.status is TerminalStatus.OPEN for state in stored(set_up).values())


def test_a_given_name_and_command(set_up: Paths, proj: Path) -> None:
    created = actions.create(set_up, proj, name="build", command=["sleep", "60"])
    assert (created.name, created.command, created.directory) == ("build", ("sleep", "60"), proj)
    assert stored(set_up)["build"].command == ("sleep", "60")


@pytest.mark.parametrize("name", ["", "-x", "a.b", "a:b", "a b", "x" * 65])
def test_invalid_names(set_up: Paths, proj: Path, name: str) -> None:
    with pytest.raises(HephaistosError, match="is not a terminal name"):
        actions.create(set_up, proj, name=name)


def test_the_longest_name(set_up: Paths, proj: Path) -> None:
    assert actions.create(set_up, proj, name="x" * 64).name == "x" * 64


def test_names_taken(set_up: Paths, keeper: TmuxKeeper, proj: Path) -> None:
    actions.create(set_up, proj, name="api")
    with pytest.raises(
        HephaistosError, match=r"^a terminal named api exists; choose another name$"
    ):
        actions.create(set_up, proj, name="api")
    tmux(keeper, "new-session", "-d", "-s", "mine")  # by hand, not observed yet
    with pytest.raises(HephaistosError, match=r"^a terminal named mine exists"):
        actions.create(set_up, proj, name="mine")
    lose_all(keeper, set_up)
    with pytest.raises(HephaistosError, match=r"^a lost terminal named api exists; kill it"):
        actions.create(set_up, proj, name="api")
    assert actions.create(set_up, proj).name == "proj-1"  # lost names stay taken


def test_default_names_skip_sessions_made_by_hand(
    set_up: Paths, keeper: TmuxKeeper, proj: Path
) -> None:
    actions.create(set_up, proj)
    tmux(keeper, "new-session", "-d", "-s", "proj-2")
    assert actions.create(set_up, proj).name == "proj-3"


@pytest.mark.stress
def test_default_names_race(set_up: Paths, proj: Path) -> None:
    script = (
        "import sys; from pathlib import Path;"
        "from hephaistos.core.terminals import actions;"
        "from hephaistos.core.utils.paths import Paths;"
        "print(actions.create(Paths.from_environment(), Path(sys.argv[1])).name)"
    )
    processes = [
        subprocess.Popen(
            [sys.executable, "-c", script, str(proj)], stdout=subprocess.PIPE, text=True
        )
        for _ in range(10)
    ]
    names = [process.communicate(timeout=60)[0].strip() for process in processes]
    assert all(process.returncode == 0 for process in processes)
    assert sorted(names, key=terminals.name_order) == [f"proj-{n}" for n in range(1, 11)]
    assert list(stored(set_up)) == [f"proj-{n}" for n in range(1, 11)]  # numbers in order


@pytest.mark.parametrize("name", ["a b", "ünï", "new\nline", "tab\tx"])
def test_odd_directories(set_up: Paths, tmp_path: Path, name: str) -> None:
    (tmp_path / name).mkdir()
    created = actions.create(set_up, tmp_path / name)
    assert created.directory == tmp_path / name
    assert created.name.endswith("-1")


def test_a_symlink_is_resolved(set_up: Paths, proj: Path, tmp_path: Path) -> None:
    (tmp_path / "link").symlink_to(proj)
    assert actions.create(set_up, tmp_path / "link").directory == proj


def test_directories_refused(set_up: Paths, tmp_path: Path) -> None:
    with pytest.raises(HephaistosError, match=r"^no directory "):
        actions.create(set_up, tmp_path / "missing")
    (tmp_path / "file").write_text("")
    with pytest.raises(HephaistosError, match=r"is not a directory$"):
        actions.create(set_up, tmp_path / "file")
    (tmp_path / "closed").mkdir(mode=0o600)
    if os.access(tmp_path / "closed", os.X_OK):
        pytest.skip("running as root: every directory can be entered")
    with pytest.raises(HephaistosError, match=r"^can't enter "):
        actions.create(set_up, tmp_path / "closed")


def test_the_directory_gone_later(set_up: Paths, tmp_path: Path) -> None:
    gone = tmp_path / "gone"
    gone.mkdir()
    actions.create(set_up, gone, name="api", command=["sleep", "60"])
    gone.rmdir()
    assert actions.rename(set_up, "api", "web").directory == gone


@pytest.mark.parametrize(
    "command",
    [
        ["sh", "-c", "exec sleep 60", "x;"],
        ["sh", "-c", "exec sleep 60", "", 'it\'s "quoted"'],
        ["sh", "-c", "exec sleep 60", *["a" * 50] * 200],
    ],
)
def test_odd_commands(set_up: Paths, proj: Path, command: list[str]) -> None:
    created = actions.create(set_up, proj, name="odd", command=command)
    assert created.command == tuple(command)


@pytest.mark.parametrize("command", [["true"], ["no-such-program-hephaistos"]])
def test_a_command_that_ends_at_once(set_up: Paths, proj: Path, command: list[str]) -> None:
    with pytest.raises(HephaistosError, match=r"^terminal quick ended at once"):
        actions.create(set_up, proj, name="quick", command=command)
    assert stored(set_up) == {}


def test_rename(set_up: Paths, keeper: TmuxKeeper, proj: Path) -> None:
    created = actions.create(set_up, proj, name="api")
    actions.create(set_up, proj, name="web")
    assert actions.rename(set_up, "api", "api").id == created.id  # the same: nothing to do
    renamed = actions.rename(set_up, "api", "back")
    assert (renamed.id, renamed.name) == (created.id, "back")
    assert {session.name for session in keeper.sessions()} == {"back", "web"}
    with pytest.raises(HephaistosError, match=r"^a terminal named web exists"):
        actions.rename(set_up, "back", "web")
    with pytest.raises(HephaistosError, match="is not a terminal name"):
        actions.rename(set_up, "back", "a.b")
    with pytest.raises(NoSuchTerminalError, match=r"^no terminal named nope on this machine$"):
        actions.rename(set_up, "nope", "x")


def test_rename_a_lost_one(set_up: Paths, keeper: TmuxKeeper, proj: Path) -> None:
    created = actions.create(set_up, proj, name="api")
    lose_all(keeper, set_up)
    renamed = actions.rename(set_up, "api", "old")
    assert (renamed.id, renamed.name, renamed.status) == (created.id, "old", "lost")


def test_kill(set_up: Paths, keeper: TmuxKeeper, proj: Path) -> None:
    actions.create(set_up, proj, name="api")
    actions.create(set_up, proj, name="web")
    assert actions.kill(set_up, "api").name == "api"
    assert list(stored(set_up)) == ["web"]
    assert {session.name for session in keeper.sessions()} == {"web"}
    with pytest.raises(NoSuchTerminalError):
        actions.kill(set_up, "api")


def test_kill_a_lost_one(set_up: Paths, keeper: TmuxKeeper, proj: Path) -> None:
    actions.create(set_up, proj, name="api")
    lose_all(keeper, set_up)
    assert actions.kill(set_up, "api").status is TerminalStatus.LOST
    assert stored(set_up) == {}


def test_kill_with_force(set_up: Paths, proj: Path, tmp_path: Path) -> None:
    script = f'trap "" HUP TERM; echo $$ > {tmp_path}/pid; exec sleep 60'
    actions.create(set_up, proj, name="stubborn", command=["sh", "-c", script])
    actions.kill(set_up, "stubborn", force=True)
    assert stored(set_up) == {}


@pytest.mark.stress
def test_kills_at_once(set_up: Paths, proj: Path) -> None:
    actions.create(set_up, proj, name="api")

    def attempt(_: int) -> str:
        try:
            actions.kill(set_up, "api")
        except NoSuchTerminalError:
            return "gone"
        return "killed"

    with ThreadPoolExecutor(2) as pool:
        outcomes = sorted(pool.map(attempt, range(2)))
    assert outcomes in (["gone", "killed"], ["killed", "killed"])
    assert stored(set_up) == {}


@pytest.mark.stress
def test_a_rename_racing_a_kill(set_up: Paths, proj: Path) -> None:
    actions.create(set_up, proj, name="api")

    def rename(_: int) -> str:
        try:
            actions.rename(set_up, "api", "web")
        except NoSuchTerminalError:
            return "gone"
        return "renamed"

    with ThreadPoolExecutor(2) as pool:
        renaming = pool.submit(rename, 0)
        pool.submit(actions.kill, set_up, "api")
        assert renaming.result() in ("gone", "renamed")
    actions.observer.observe(set_up)
    assert len(stored(set_up)) <= 1


def test_lost_ones_are_logged(
    set_up: Paths, keeper: TmuxKeeper, proj: Path, caplog: pytest.LogCaptureFixture
) -> None:
    actions.create(set_up, proj, name="api")
    actions.create(set_up, proj, name="web")
    with caplog.at_level(logging.INFO, logger="hephaistos.core.state.terminals"):
        lose_all(keeper, set_up)
    assert [(r.levelname, r.getMessage()) for r in caplog.records] == [
        ("WARNING", "the Keeper's server is gone: 2 terminals lost"),
    ]
