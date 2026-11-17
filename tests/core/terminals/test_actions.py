import logging
import os
import signal
import subprocess
import sys
import uuid
from collections.abc import Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import pytest

from hephaistos.core.db.sessions import read_session, write_session
from hephaistos.core.registry import machines
from hephaistos.core.state import terminals
from hephaistos.core.state.terminals import NoSuchTerminalError, TerminalStatus
from hephaistos.core.terminals import actions
from hephaistos.core.terminals.keeper import Session
from hephaistos.core.terminals.tmux import TmuxKeeper
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.paths import Paths
from support import eventually, slow_scopes

pytestmark = pytest.mark.tmux


@pytest.fixture
def set_up(paths: Paths, keeper: TmuxKeeper) -> Paths:
    """A Machine whose Keeper is the one of this test, its server ended afterwards."""
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
    with pytest.raises(HephaistosError, match=r"^cannot enter "):
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


@pytest.fixture
def settled(keeper: TmuxKeeper, monkeypatch: pytest.MonkeyPatch) -> TmuxKeeper:
    """The Keeper, whose `create` returns once the program it started ended, which it must: so
    the observation after it finds that, whatever the load."""
    create = keeper.create

    def created_then_settled(
        terminal_id: uuid.UUID,
        name: str,
        directory: Path,
        command: Sequence[str] | None,
        environment: Mapping[str, str],
    ) -> Session:
        session = create(terminal_id, name, directory, command, environment)
        eventually(lambda: all(s.ending for s in keeper.sessions() if s.name == name) or None)
        return session

    monkeypatch.setattr(keeper, "create", created_then_settled)
    return keeper


@pytest.fixture
def slow(keeper: TmuxKeeper, tmp_path: Path) -> TmuxKeeper:
    """A Keeper on the same socket, with slow scopes; see `slow_scopes`."""
    return TmuxKeeper(
        binary=keeper.binary,
        socket=keeper.socket,
        config_file=keeper.config_file,
        history=keeper.history,
        detect_scopes=lambda: slow_scopes(tmp_path),
    )


@pytest.mark.parametrize(
    ("command", "status"), [(["true"], 0), (["false"], 1), (["no-such-program-hephaistos"], 127)]
)
def test_a_command_that_ended_already_is_created_ended(
    set_up: Paths, settled: TmuxKeeper, proj: Path, command: list[str], status: int
) -> None:
    """To be seen, e.g. what a typo gave: its screen stays."""
    keeper = settled
    created = actions.create(set_up, proj, name="quick", command=command, keeper=keeper)
    assert (created.status, created.exit_status, created.command) == (
        TerminalStatus.ENDED,
        status,
        tuple(command),
    )
    assert stored(set_up)["quick"] == created
    assert created.program == command[0]  # not a wrapper tmux gave, while starting or dead
    if status == 127:
        assert "no-such-program-hephaistos" in everything(keeper, "quick")


def test_a_command_still_starting_is_created_open(
    set_up: Paths, slow: TmuxKeeper, proj: Path
) -> None:
    """Then it ends as any command does, staying with its screen."""
    command = ["no-such-program-hephaistos"]
    created = actions.create(set_up, proj, name="quick", command=command, keeper=slow)
    assert created.status is TerminalStatus.OPEN  # its wrapper still waits
    eventually(lambda: slow.session("quick").ending)
    actions.observer.observe(set_up, slow)
    state = stored(set_up)["quick"]
    assert (state.status, state.exit_status) == (TerminalStatus.ENDED, 127)


def test_a_shell_that_closed_already(set_up: Paths, settled: TmuxKeeper, proj: Path) -> None:
    """E.g. a profile that exits: refused, as nothing is left of it."""
    with pytest.raises(
        HephaistosError,
        match=r"^terminal quick closed: its shell, /bin/false, exited;"
        r" check SHELL, or the profile of that shell$",
    ):
        actions.create(
            set_up, proj, name="quick", keeper=settled, environment={"SHELL": "/bin/false"}
        )
    assert stored(set_up) == {}


def test_a_shell_still_starting_is_created_open(
    set_up: Paths, slow: TmuxKeeper, proj: Path
) -> None:
    """Then it closes as any shell that exits does."""
    environment = {"SHELL": "/bin/false"}
    created = actions.create(set_up, proj, name="quick", keeper=slow, environment=environment)
    assert created.status is TerminalStatus.OPEN
    eventually(lambda: not slow.sessions())
    actions.observer.observe(set_up, slow)
    assert stored(set_up) == {}
    with pytest.raises(
        HephaistosError, match=r"^terminal quick closed before attaching: its shell, /bin/false,"
    ):
        actions.attach_created(set_up, created, keeper=slow, environment=environment)


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


def test_kill_one_lost_meanwhile(
    set_up: Paths, keeper: TmuxKeeper, proj: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    actions.create(set_up, proj, name="api")
    kill = keeper.kill

    def crashed_first(name: str, *, force: bool = False) -> None:
        tmux(keeper, "kill-server")  # the server ends after the first observation
        kill(name, force=force)

    monkeypatch.setattr(keeper, "kill", crashed_first)
    actions.kill(set_up, "api", keeper=keeper)
    assert stored(set_up) == {}  # not left as lost


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
        ("WARNING", "the server of the keeper is gone: 2 terminals lost"),
    ]


def keeper_options(keeper: TmuxKeeper) -> list[str]:
    return ["-u", "-L", keeper.socket, "-f", str(keeper.config_file)]


def everything(keeper: TmuxKeeper, name: str) -> str:
    """What the pane of a Terminal shows, its scrollback included."""
    return tmux(keeper, "capture-pane", "-p", "-J", "-S", "-", "-t", f"={name}:")


def prompted(keeper: TmuxKeeper, name: str) -> None:
    """Waits for the prompt of its shell: keys typed while its profile runs may be lost."""
    eventually(lambda: everything(keeper, name).rstrip().endswith("$"))


def screen(keeper: TmuxKeeper, name: str) -> str:
    """What the pane of a Terminal shows, once its shell has printed something."""
    return eventually(lambda: tmux(keeper, "capture-pane", "-p", "-J", "-t", f"={name}:").strip())


def test_attach(set_up: Paths, keeper: TmuxKeeper, proj: Path) -> None:
    created = actions.create(set_up, proj, name="api")
    found, command = actions.attach(set_up, "api", environment={})
    assert found.id == created.id
    key = keeper.session("api").key
    assert command == [keeper.binary, *keeper_options(keeper), "attach-session", "-t", key]


def test_attach_refuses_a_tty_the_terminal_shows(
    set_up: Paths, keeper: TmuxKeeper, proj: Path
) -> None:
    actions.create(set_up, proj, name="api")
    tty = tmux(keeper, "display-message", "-p", "-t", keeper.session("api").key, "#{pane_tty}")
    with pytest.raises(
        HephaistosError,
        match=r"^this runs inside terminal api; attach to it from another terminal emulator$",
    ):
        actions.attach(set_up, "api", environment={}, tty=tty.strip())
    actions.attach(set_up, "api", environment={}, tty="/dev/pts/nonexistent")


def test_two_restores_at_once(
    set_up: Paths, keeper: TmuxKeeper, proj: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    created = actions.create(set_up, proj, name="api")
    lose_all(keeper, set_up)
    create = keeper.create

    def raced(*args: Any) -> Session:  # noqa: ANN401 - those of `create`
        create(*args)  # another attach, which had seen it lost too, restores it first
        return create(*args)

    monkeypatch.setattr(keeper, "create", raced)
    found, command = actions.attach(set_up, "api", keeper=keeper, environment={"SHELL": "/bin/sh"})
    assert (found.id, found.status) == (created.id, TerminalStatus.OPEN)
    assert command[-2:] == ["-t", keeper.session("api").key]


def test_a_created_one_attaches_by_its_id(set_up: Paths, keeper: TmuxKeeper, proj: Path) -> None:
    created = actions.create(set_up, proj, name="api")
    tmux(keeper, "rename-session", "-t", keeper.session("api").key, "renamed")
    command = actions.attach_created(set_up, created, keeper=keeper)
    assert command[-2:] == ["-t", keeper.session("renamed").key]


def test_a_created_command_that_ended_before_attaching(
    set_up: Paths, keeper: TmuxKeeper, proj: Path
) -> None:
    """It attaches to its last screen."""
    created = actions.create(set_up, proj, name="build", command=["sleep", "0.5"])
    eventually(lambda: keeper.session("build").ending)
    command = actions.attach_created(set_up, created, keeper=keeper)
    assert command[-2:] == ["-t", keeper.session("build").key]


def test_a_created_shell_that_exited_before_attaching(
    set_up: Paths, keeper: TmuxKeeper, proj: Path
) -> None:
    created = actions.create(set_up, proj, name="sh", environment={"SHELL": "/bin/sh"})
    prompted(keeper, "sh")
    tmux(keeper, "send-keys", "-t", "=sh:", "exit 1", "Enter")
    eventually(lambda: not keeper.sessions())
    with pytest.raises(
        HephaistosError,
        match=r"^terminal sh closed before attaching: its shell, /bin/sh, exited;"
        r" check SHELL, or the profile of that shell$",
    ):
        actions.attach_created(set_up, created, keeper=keeper, environment={"SHELL": "/bin/sh"})


def test_attach_to_one_ended_meanwhile(
    set_up: Paths, keeper: TmuxKeeper, proj: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    actions.create(set_up, proj, name="api")
    observe = actions.observer.observe

    def observed_then_killed(*args: object, **kwargs: object) -> object:
        result = observe(*args, **kwargs)  # type: ignore[arg-type]
        tmux(keeper, "kill-session", "-t", keeper.session("api").key)
        return result

    monkeypatch.setattr(actions.observer, "observe", observed_then_killed)
    with pytest.raises(HephaistosError, match=r"^terminal api closed meanwhile$"):
        actions.attach(set_up, "api", keeper=keeper, environment={})


def test_attach_decides_by_the_tty_not_the_variable(set_up: Paths, proj: Path) -> None:
    """`HEPHAISTOS_TERMINAL` spreads, e.g. into a tmux of the user whose server started inside the
    Terminal, and from there into sessions shown elsewhere: attaching there is fine."""
    created = actions.create(set_up, proj, name="api")
    spread = {"HEPHAISTOS_TERMINAL": str(created.id)}
    found, _ = actions.attach(set_up, "api", environment=spread, tty="/dev/pts/nonexistent")
    assert found.id == created.id
    with pytest.raises(NoSuchTerminalError):
        actions.attach(set_up, "nope", environment={})


def test_attach_restores_a_lost_one_as_a_shell(
    set_up: Paths, keeper: TmuxKeeper, proj: Path
) -> None:
    created = actions.create(set_up, proj, name="build", command=["sleep", "600"])
    lose_all(keeper, set_up)
    lost = stored(set_up)["build"]
    found, _ = actions.attach(set_up, "build", environment={"SHELL": "/bin/sh"})
    assert (found.id, found.name, found.status, found.command) == (
        created.id,
        "build",
        TerminalStatus.OPEN,
        None,  # it runs a shell now, not its command again
    )
    session = keeper.session("build")
    assert (session.terminal_id, session.directory) == (created.id, proj)
    assert lost.lost_at is not None
    assert screen(keeper, "build").startswith(
        "restored after the tmux server ended:"
        f" found lost at {lost.lost_at.astimezone():%Y-%m-%d %H:%M},"
        f" last active at {lost.active_at.astimezone():%Y-%m-%d %H:%M};"
        " earlier output is gone; it ran: sleep 600"
    )
    assert eventually(lambda: keeper.session("build").program == "sh")  # the login shell


def test_a_restored_one_says_the_machine_restarted(
    set_up: Paths, keeper: TmuxKeeper, proj: Path
) -> None:
    actions.create(set_up, proj, name="api")
    with write_session(set_up) as session:  # as if seen last in another boot
        state = terminals.by_name(session, "api")
        session.conn.execute(
            "UPDATE state_terminals SET boot_id = 'before' WHERE id = ?", (state.id.bytes,)
        )
    lose_all(keeper, set_up)
    assert stored(set_up)["api"].lost_because == "reboot"
    actions.attach(set_up, "api", environment={"SHELL": "/bin/sh"})
    assert screen(keeper, "api").startswith("restored after the machine restarted: found lost at")


def test_a_restored_one_whose_directory_is_gone_starts_at_home(
    set_up: Paths, keeper: TmuxKeeper, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    gone = tmp_path / "gone"
    gone.mkdir()
    actions.create(set_up, gone, name="api")
    lose_all(keeper, set_up)
    gone.rmdir()
    home = tmp_path / "home-of-user"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    actions.attach(set_up, "api", environment={"SHELL": "/bin/sh"})
    assert f"{gone} is gone, so it starts in the home directory" in screen(keeper, "api")
    assert keeper.session("api").current_directory == home
    assert stored(set_up)["api"].directory == gone  # where it started, as before


# Ended ones: their session stays until killed; those whose session went too keep their row.


def ended_one(paths: Paths, keeper: TmuxKeeper, proj: Path, name: str = "build") -> None:
    """Creates a command Terminal that ends with status 3, once observed so."""
    actions.create(paths, proj, name=name, command=["sh", "-c", "echo built; exit 3"])
    eventually(lambda: keeper.session(name).ending)
    actions.observer.observe(paths, keeper)


def test_attach_to_an_ended_one_shows_its_last_screen(
    set_up: Paths, keeper: TmuxKeeper, proj: Path
) -> None:
    ended_one(set_up, keeper, proj)
    found, command = actions.attach(set_up, "build", environment={})
    assert (found.status, found.exit_status) == (TerminalStatus.ENDED, 3)
    assert command[-2:] == ["-t", keeper.session("build").key]
    assert "built" in everything(keeper, "build")
    assert len(keeper.sessions()) == 1  # nothing started again


def test_attach_to_an_ended_one_whose_screen_went(
    set_up: Paths, keeper: TmuxKeeper, proj: Path
) -> None:
    """Refused, as there is nothing to show; nothing starts again, as its command may have been
    anything, e.g. a deployment."""
    ended_one(set_up, keeper, proj)
    lose_all(keeper, set_up)
    with pytest.raises(
        HephaistosError,
        match=r"^terminal build exited with status 3; its last screen is gone,"
        r" as the tmux server ended$",
    ):
        actions.attach(set_up, "build", environment={"SHELL": "/bin/sh"})
    assert keeper.sessions() == []
    assert stored(set_up)["build"].status is TerminalStatus.ENDED


def test_names_taken_by_ended_ones(set_up: Paths, keeper: TmuxKeeper, proj: Path) -> None:
    ended_one(set_up, keeper, proj)
    taken = r"^an ended terminal named build exists; kill it, or choose another name$"
    with pytest.raises(HephaistosError, match=taken):
        actions.create(set_up, proj, name="build")
    actions.create(set_up, proj, name="api")
    with pytest.raises(HephaistosError, match=taken):
        actions.rename(set_up, "api", "build")
    assert actions.create(set_up, proj).name == "proj-1"
    ended_one(set_up, keeper, proj, name="proj-2")
    lose_all(keeper, set_up)  # a name stays taken while the row holds it
    assert actions.create(set_up, proj).name == "proj-3"


def test_rename_an_ended_one(set_up: Paths, keeper: TmuxKeeper, proj: Path) -> None:
    ended_one(set_up, keeper, proj)
    renamed = actions.rename(set_up, "build", "built")
    assert (renamed.name, renamed.status, renamed.exit_status) == ("built", "ended", 3)
    assert keeper.session("built").ending is not None
    lose_all(keeper, set_up)
    again = actions.rename(set_up, "built", "old")  # its row alone
    assert (again.name, again.status, again.session_gone) == ("old", "ended", True)


@pytest.mark.parametrize("force", [False, True])
def test_kill_an_ended_one(set_up: Paths, keeper: TmuxKeeper, proj: Path, force: bool) -> None:  # noqa: FBT001
    ended_one(set_up, keeper, proj)
    actions.create(set_up, proj, name="api")
    killed = actions.kill(set_up, "build", force=force)
    assert (killed.name, killed.status) == ("build", TerminalStatus.ENDED)
    assert [session.name for session in keeper.sessions()] == ["api"]
    assert list(stored(set_up)) == ["api"]


def test_kill_an_ended_one_whose_session_went(
    set_up: Paths, keeper: TmuxKeeper, proj: Path
) -> None:
    ended_one(set_up, keeper, proj)
    lose_all(keeper, set_up)
    killed = actions.kill(set_up, "build")
    assert (killed.status, killed.session_gone) == (TerminalStatus.ENDED, True)
    assert stored(set_up) == {}


def test_a_command_that_ends_while_running_is_kept(
    set_up: Paths, keeper: TmuxKeeper, proj: Path
) -> None:
    """With how and when, through observations that come after."""
    actions.create(set_up, proj, name="job", command=["sh", "-c", "sleep 0.5; kill -TERM $$"])
    assert stored(set_up)["job"].status is TerminalStatus.OPEN
    eventually(lambda: keeper.session("job").ending)
    for _ in range(3):
        actions.observer.observe(set_up, keeper)
    state = stored(set_up)["job"]
    assert (state.status, state.exit_status, state.ended_at is not None) == ("ended", None, True)
    assert terminals.ending_text(state) in {"ended by signal 15 (SIGTERM)", "ended by a signal"}


def test_a_shell_that_exits_loses_its_row(set_up: Paths, keeper: TmuxKeeper, proj: Path) -> None:
    actions.create(set_up, proj, name="sh", environment={"SHELL": "/bin/sh"})
    prompted(keeper, "sh")
    tmux(keeper, "send-keys", "-t", "=sh:", "false; exit", "Enter")
    eventually(lambda: not keeper.sessions())
    actions.observer.observe(set_up, keeper)
    assert stored(set_up) == {}


def test_a_shell_ended_by_a_signal_stays(set_up: Paths, keeper: TmuxKeeper, proj: Path) -> None:
    """E.g. by the OOM killer: seen, not gone without a word."""
    actions.create(set_up, proj, name="sh", environment={"SHELL": "/bin/sh"})
    pid = keeper.session("sh").pid
    assert pid is not None
    os.kill(pid, signal.SIGKILL)
    eventually(lambda: keeper.session("sh").ending)
    actions.observer.observe(set_up, keeper)
    state = stored(set_up)["sh"]
    assert (state.status, state.command, state.exit_status) == ("ended", None, None)
