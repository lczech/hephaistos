import os
import re
import shlex
import signal
import subprocess
import time
import uuid
from collections.abc import Mapping
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from hephaistos.core import config
from hephaistos.core.terminals.keeper import (
    Ending,
    KeeperError,
    NameTakenError,
    NoSuchSessionError,
    Session,
)
from hephaistos.core.terminals.tmux import (
    BUS_VARIABLE,
    CONFIG_OPTION,
    NO_BUS,
    Installation,
    TmuxKeeper,
    config_digest,
    config_text,
    installation,
    parse_version,
    scope_of,
    socket_name,
)
from support import eventually

pytestmark = pytest.mark.tmux


def tmux(keeper: TmuxKeeper, *args: str, config: str = "/dev/null") -> str:
    """Runs tmux on the socket of `keeper` like a user, with its own config; returns its output."""
    command = [keeper.binary, "-L", keeper.socket, "-f", config, *args]
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    assert result.returncode == 0, f"tmux {args[0]} failed: {result.stderr}"
    return result.stdout


def new(
    keeper: TmuxKeeper, name: str, directory: Path, *command: str, **environment: str
) -> Session:
    """Creates a Terminal with a new ID, running `command` (else a shell)."""
    return keeper.create(uuid.uuid4(), name, directory, command or None, environment)


def written(path: Path, lines: int = 1) -> str:
    """The text of a file, once the program of a Terminal has written `lines` lines to it."""

    def text() -> str:
        found = path.read_text() if path.exists() else ""
        return found if found.count("\n") >= lines else ""

    return eventually(text)


def gone(pid: int) -> bool:
    """Whether a process ended. A zombie counts: tmux on Ubuntu, built with systemd, sometimes
    reaps the process of a pane only when its next child ends."""
    try:
        return Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[0] == "Z"
    except FileNotFoundError:
        return True


@pytest.mark.parametrize(
    ("text", "version"),
    [
        ("tmux 3.2a\n", (3, 2)),
        ("tmux 3.4", (3, 4)),
        ("tmux 3.10", (3, 10)),
        ("tmux next-3.6", (3, 6)),
        ("tmux 3.8_", (3, 8)),  # as builds from conda-forge call some
        ("tmux master", None),
        ("tmux openbsd-7.5", None),
        ("nonsense", None),
    ],
)
def test_versions(text: str, version: tuple[int, int] | None) -> None:
    assert parse_version(text) == version


def test_versions_compare_as_numbers() -> None:
    assert parse_version("tmux 3.10") > parse_version("tmux 3.9")  # type: ignore[operator]


def test_socket_names(tmp_path: Path) -> None:
    assert socket_name("mine", {"HEPHAISTOS_HOME": str(tmp_path)}) == "mine"
    assert socket_name("auto", {}) == "hephaistos"
    own = socket_name("auto", {"HEPHAISTOS_HOME": str(tmp_path)})
    assert own.startswith("hephaistos-")
    assert own == socket_name("auto", {"HEPHAISTOS_HOME": f"{tmp_path}/."})
    assert own != socket_name("auto", {"HEPHAISTOS_HOME": str(tmp_path / "other")})


def test_config_names_itself_by_its_hash() -> None:
    text = config_text(1234)
    assert "set -g history-limit 1234\n" in text
    # The look and the keys of tmux stay as they are, but for Ctrl+D in a dead pane.
    assert not re.search(r"\bstatus\b", text)
    assert [line for line in text.splitlines() if "bind" in line] == [
        'bind -n C-d if-shell -F "#{pane_dead}" kill-pane "send-keys C-d"'
    ]
    assert text.endswith(f"set -g {CONFIG_OPTION} {config_digest(text)}\n")
    assert config_digest(text) == config_digest(config_text(1234))
    assert config_digest(text) != config_digest(config_text(99))


def test_tmux_stays_out_of_sight_in_a_terminal(keeper: TmuxKeeper, tmp_path: Path) -> None:
    """Nothing in a Terminal says tmux keeps it, so a `tmux` typed there reaches the default
    server of the user, as from any terminal emulator, not ours."""
    other = tmp_path / "tmux-tmpdir"  # stands in for the default server of the user
    other.mkdir()
    script = (
        'printf "%s|%s|" "${TMUX-unset}" "${TMUX_PANE-unset}" > out;'
        f" TMUX_TMPDIR={other} tmux -f /dev/null new-session -d -s mine sleep 60;"
        f' TMUX_TMPDIR={other} tmux ls -F "#{{session_name}}" >> out 2>&1; exec sleep 60'
    )
    created = new(keeper, "api", tmp_path, "sh", "-c", script)
    try:
        assert written(tmp_path / "out") == "unset|unset|mine\n"
        assert [session.name for session in keeper.sessions()] == ["api"]
        assert eventually(lambda: keeper.session("api").program == "sleep")  # not `env`
        assert created.terminal_id is not None
    finally:
        subprocess.run(
            ["tmux", "kill-server"],
            env={**os.environ, "TMUX_TMPDIR": str(other)},
            capture_output=True,
            check=False,
        )


def test_control_mode_shows_no_bar(keeper: TmuxKeeper, tmp_path: Path) -> None:
    """The bar of tmux shows to a plain client, as from the CLI; a client in control mode, as
    the GUI uses, gets the whole window, with no row taken for a bar."""
    new(keeper, "api", tmp_path)
    shown = "#{status} #{window_height}"
    commands = f"refresh-client -C 80,24\ndisplay-message -p 'seen: {shown}'\n"
    control = [keeper.binary, "-L", keeper.socket, "-C", "attach-session", "-t", "=api"]
    result = subprocess.run(control, input=commands, capture_output=True, text=True, check=False)
    assert "seen: on 24" in result.stdout


def test_create_and_list(keeper: TmuxKeeper, tmp_path: Path) -> None:
    terminal_id = uuid.uuid4()
    out = tmp_path / "out"
    script = 'printf "%s %s\\n" "$HEPHAISTOS_TERMINAL" "$SSH_AUTH_SOCK" > out; exec sleep 60'
    created = keeper.create(
        terminal_id, "api", tmp_path, ["sh", "-c", script], {"SSH_AUTH_SOCK": "/agent"}
    )
    assert created.terminal_id == terminal_id
    assert created.name == "api"
    assert created.directory == tmp_path
    assert created.panes == 1
    assert created.clients == 0
    assert written(out) == f"{terminal_id} /agent\n"
    [session] = keeper.sessions()
    assert session.key == created.key
    assert session.program == "sleep"
    assert session.current_directory == tmp_path


def test_a_shell_without_a_command(keeper: TmuxKeeper, tmp_path: Path) -> None:
    new(keeper, "sh", tmp_path, SHELL="/bin/sh")
    eventually(lambda: [s.program for s in keeper.sessions()] == ["sh"])


def test_arguments_arrive_as_given(keeper: TmuxKeeper, tmp_path: Path) -> None:
    script = 'printf "%s|%s\\n" "$1" "$2" > out; exec sleep 60'
    new(keeper, "args", tmp_path, "sh", "-c", script, "sh", "a;", "b c")
    assert written(tmp_path / "out") == "a;|b c\n"


def test_no_sessions_without_a_server(keeper: TmuxKeeper) -> None:
    assert keeper.sessions() == []


def test_a_taken_name(keeper: TmuxKeeper, tmp_path: Path) -> None:
    new(keeper, "api", tmp_path)
    with pytest.raises(NameTakenError, match="a terminal named api exists already"):
        new(keeper, "api", tmp_path)
    assert len(keeper.sessions()) == 1


def test_names_are_matched_exactly(keeper: TmuxKeeper, tmp_path: Path) -> None:
    new(keeper, "ab", tmp_path)
    with pytest.raises(NoSuchSessionError, match=r"^no terminal named a$"):
        keeper.kill("a")
    with pytest.raises(NoSuchSessionError):
        keeper.rename("a", "c")
    new(keeper, "a", tmp_path)
    keeper.kill("a")
    assert [session.name for session in keeper.sessions()] == ["ab"]


def test_rename(keeper: TmuxKeeper, tmp_path: Path) -> None:
    created = new(keeper, "api", tmp_path)
    new(keeper, "web", tmp_path)
    with pytest.raises(NameTakenError, match="a terminal named web exists already"):
        keeper.rename("api", "web")
    keeper.rename("api", "api-2")
    renamed = keeper.session("api-2")
    assert (renamed.key, renamed.terminal_id) == (created.key, created.terminal_id)


def test_unknown_names_without_a_server(keeper: TmuxKeeper) -> None:
    for act in (lambda: keeper.kill("x"), lambda: keeper.rename("x", "y")):
        with pytest.raises(NoSuchSessionError):
            act()


def test_after_the_server_died(keeper: TmuxKeeper, tmp_path: Path) -> None:
    new(keeper, "api", tmp_path)
    tmux(keeper, "kill-server")
    assert keeper.sessions() == []
    with pytest.raises(NoSuchSessionError):
        keeper.rename("api", "web")


def test_the_server_outlives_its_last_session(keeper: TmuxKeeper, tmp_path: Path) -> None:
    new(keeper, "api", tmp_path)
    keeper.kill("api")
    time.sleep(0.2)
    assert keeper.running()
    assert keeper.sessions() == []


def test_concurrent_creators_share_one_server(keeper: TmuxKeeper, tmp_path: Path) -> None:
    def create(n: int) -> Session:
        return new(keeper, f"t{n}", tmp_path)

    with ThreadPoolExecutor(10) as pool:
        list(pool.map(create, range(10)))
    assert sorted(s.name for s in keeper.sessions()) == sorted(f"t{n}" for n in range(10))
    assert len(set(tmux(keeper, "list-sessions", "-F", "#{pid}").split())) == 1


def test_one_wins_a_race_for_a_name(keeper: TmuxKeeper, tmp_path: Path) -> None:
    def attempt(_: int) -> bool:
        try:
            new(keeper, "api", tmp_path)
        except NameTakenError:
            return False
        return True

    with ThreadPoolExecutor(10) as pool:
        assert sorted(pool.map(attempt, range(10))) == [False] * 9 + [True]
    assert len(keeper.sessions()) == 1


def test_odd_sessions_made_by_hand(keeper: TmuxKeeper, tmp_path: Path) -> None:
    odd = {"x y": "a b", "ünï-😀": "ünï", "-lead": "tab\tx", "nl": "new\nline"}
    for name, directory in odd.items():
        (tmp_path / directory).mkdir()
        tmux(keeper, "new-session", "-d", "-s", name, "-c", str(tmp_path / directory))
    found = {session.name: session for session in keeper.sessions()}
    assert {name: found[name].directory for name in odd} == {
        name: tmp_path / directory for name, directory in odd.items()
    }
    assert all(session.terminal_id is None for session in found.values())


def test_control_characters_made_by_hand(keeper: TmuxKeeper, tmp_path: Path) -> None:
    # tmux 3.2a prints them raw, newer versions as octal escapes, and 3.7 refuses them in names:
    # what exists is listed either way, as tmux shows it, and the others are untouched.
    (tmp_path / "c\x01d").mkdir()
    tmux(keeper, "new-session", "-d", "-s", "odd", "-c", str(tmp_path / "c\x01d"))
    tmux(keeper, "new-session", "-d", "-s", "plain", "-c", str(tmp_path))
    command = [keeper.binary, "-L", keeper.socket, "new-session", "-d", "-s", "a\x01b"]
    named = subprocess.run(command, capture_output=True, check=False).returncode == 0
    found = {session.name: session for session in keeper.sessions()}
    assert len(found) == 3 if named else 2
    assert found["plain"].directory == tmp_path
    assert found["odd"].directory in (tmp_path / "c\x01d", tmp_path / "c\\001d")
    if named:
        assert {"a\x01b", "a\\001b"} & set(found)


def test_adopt(keeper: TmuxKeeper, tmp_path: Path) -> None:
    tmux(keeper, "new-session", "-d", "-s", "mine", "-c", str(tmp_path))
    found = keeper.session("mine")
    assert (found.terminal_id, found.id_text) == (None, "")
    terminal_id = uuid.uuid4()
    assert keeper.adopt(found, terminal_id) == terminal_id
    assert keeper.session("mine").terminal_id == terminal_id


def test_adopting_agrees_with_another_adopter(keeper: TmuxKeeper, tmp_path: Path) -> None:
    tmux(keeper, "new-session", "-d", "-s", "mine", "-c", str(tmp_path))
    listed = keeper.session("mine")  # both listed it without an ID
    first, second = uuid.uuid4(), uuid.uuid4()
    assert keeper.adopt(listed, first) == first
    assert keeper.adopt(listed, second) == first  # the other got there first


@pytest.mark.parametrize("text", ["not-an-id", 'it\'s "odd" #{x}', "a b;c"])
def test_adopting_replaces_an_id_that_isnt_one(
    keeper: TmuxKeeper, tmp_path: Path, text: str
) -> None:
    tmux(keeper, "new-session", "-d", "-s", "mine", "-c", str(tmp_path))
    tmux(keeper, "set-option", "-t", "=mine:", "@hephaistos_id", text)
    found = keeper.session("mine")
    assert (found.terminal_id, found.id_text) == (None, text)
    terminal_id = uuid.uuid4()
    assert keeper.adopt(found, terminal_id) == terminal_id


def test_adopting_a_session_gone(keeper: TmuxKeeper, tmp_path: Path) -> None:
    new(keeper, "other", tmp_path)  # keeps the server
    tmux(keeper, "new-session", "-d", "-s", "mine", "-c", str(tmp_path))
    found = keeper.session("mine")
    keeper.kill("mine")
    assert keeper.adopt(found, uuid.uuid4()) is None


def option(keeper: TmuxKeeper, name: str) -> str:
    return tmux(keeper, "show-options", "-gqv", name).strip()


def test_our_config_reaches_a_server_started_by_hand(keeper: TmuxKeeper, tmp_path: Path) -> None:
    tmux(keeper, "new-session", "-d", "-s", "mine", "-c", str(tmp_path))
    assert option(keeper, "history-limit") == "2000"  # the default of tmux
    keeper.sessions()
    assert option(keeper, "history-limit") == str(config.settings().terminals.history)
    assert option(keeper, CONFIG_OPTION) == config_digest(keeper.config)


def test_the_look_and_keys_of_tmux_stay(keeper: TmuxKeeper, tmp_path: Path) -> None:
    """Attaching from the CLI is plain tmux: its status bar and every key it binds."""
    new(keeper, "api", tmp_path)
    assert option(keeper, "status") == "on"
    assert option(keeper, "prefix") == "C-b"
    keys = tmux(keeper, "list-keys", "-T", "prefix").splitlines()
    assert {"c", "d", "[", "n", "o"} <= {line.split()[3] for line in keys}
    tmux(keeper, "set-option", "-g", CONFIG_OPTION, "outdated")  # as after a settings change
    keeper.sessions()  # loads it again, which changes nothing else
    assert option(keeper, CONFIG_OPTION) == config_digest(keeper.config)
    assert tmux(keeper, "list-keys", "-T", "prefix").splitlines() == keys


def test_the_users_tmux_config_stays_out(keeper: TmuxKeeper, tmp_path: Path) -> None:
    Path(os.environ["HOME"], ".tmux.conf").write_text("set -g status off\nset -g @theirs 1\n")
    new(keeper, "api", tmp_path)
    assert option(keeper, "status") == "on"
    assert option(keeper, "@theirs") == ""


def test_a_split_session_counts_its_panes(keeper: TmuxKeeper, tmp_path: Path) -> None:
    new(keeper, "api", tmp_path)
    tmux(keeper, "split-window", "-t", "=api:")
    tmux(keeper, "new-window", "-t", "=api:")
    [session] = keeper.sessions()
    assert session.panes == 3


def test_many_terminals_list_quickly(keeper: TmuxKeeper, tmp_path: Path) -> None:
    for batch in range(0, 200, 25):  # tmux limits the length of one command list
        commands: list[str] = []
        for n in range(batch, batch + 25):
            commands += ["new-session", "-d", "-s", f"t{n}", "-c", str(tmp_path), ";"]
        tmux(keeper, *commands[:-1])
    start = time.monotonic()
    assert len(keeper.sessions()) == 200
    assert time.monotonic() - start < 2


STUBBORN = 'trap "" HUP TERM; sleep 1001 & echo $! > pids; echo $$ >> pids; wait'


def stubborn(keeper: TmuxKeeper, tmp_path: Path) -> list[int]:
    """A Terminal whose shell and background job ignore SIGHUP and SIGTERM; their PIDs."""
    new(keeper, "stubborn", tmp_path, "sh", "-c", STUBBORN)
    return [int(pid) for pid in written(tmp_path / "pids", lines=2).split()]


def pane_tty(keeper: TmuxKeeper, name: str) -> str:
    return tmux(
        keeper, "display-message", "-p", "-t", keeper.session(name).key, "#{pane_tty}"
    ).strip()


def test_what_a_session_shows(keeper: TmuxKeeper, tmp_path: Path) -> None:
    api, web = new(keeper, "api", tmp_path), new(keeper, "web", tmp_path)
    new(keeper, "other", tmp_path)
    assert keeper.shows(api, pane_tty(keeper, "api"))  # its own pane
    assert not keeper.shows(api, pane_tty(keeper, "web"))
    assert not keeper.shows(api, "/dev/pts/nonexistent")
    # web attached inside api: api shows the pane of web too, so attaching api there would loop.
    attach = shlex.join(keeper.attach_command(web))
    tmux(keeper, "send-keys", "-t", api.key, attach, "Enter")
    eventually(lambda: keeper.session("web").clients == 1)
    assert keeper.shows(api, pane_tty(keeper, "web"))
    assert not keeper.shows(web, pane_tty(keeper, "api"))
    assert not keeper.shows(api, pane_tty(keeper, "other"))


def test_a_dead_pane_shows_nothing(keeper: TmuxKeeper, tmp_path: Path) -> None:
    """tmux keeps the name of the pty it closed, which the next pane, of any program, may get:
    attaching there loops nothing."""
    build = new(keeper, "build", tmp_path, "sh", "-c", "exit 3")
    tty = tmux(keeper, "display-message", "-p", "-t", build.key, "#{pane_tty}").strip()
    ending(keeper, "build")
    assert tmux(keeper, "display-message", "-p", "-t", build.key, "#{pane_tty}").strip() == tty
    assert not keeper.shows(build, tty)


def test_nothing_shows_without_a_server(keeper: TmuxKeeper, tmp_path: Path) -> None:
    api = new(keeper, "api", tmp_path)
    tmux(keeper, "kill-server")
    assert not keeper.shows(api, "/dev/pts/0")


def test_kill_hangs_up(keeper: TmuxKeeper, tmp_path: Path) -> None:
    pids = stubborn(keeper, tmp_path)
    keeper.kill("stubborn")
    assert keeper.sessions() == []
    time.sleep(0.2)
    survivors = [pid for pid in pids if not gone(pid)]
    assert survivors  # what ignores SIGHUP outlives its Terminal: `force` is for that
    for pid in survivors:
        os.kill(pid, signal.SIGKILL)


def test_kill_with_force(keeper: TmuxKeeper, tmp_path: Path) -> None:
    pids = stubborn(keeper, tmp_path)
    keeper.kill("stubborn", force=True)
    assert keeper.sessions() == []
    eventually(lambda: all(map(gone, pids)))


# How Terminals end: a command stays, showing its last screen; a shell that exited closes; one a
# signal ended stays.


def says_signals(keeper: TmuxKeeper) -> bool:
    """Whether this tmux says which signal ended a pane, and when: 3.3 and later."""
    version = installation(keeper.binary).version
    return version is None or version >= (3, 3)


def ending(keeper: TmuxKeeper, name: str) -> Ending:
    """How the program of the Terminal named `name` ended, once it did."""
    found = eventually(lambda: keeper.session(name).ending)
    assert found is not None
    return found


def closed(keeper: TmuxKeeper, name: str) -> bool:
    """Whether the session named `name` is gone, once it is."""
    return eventually(lambda: name not in {session.name for session in keeper.sessions()})


def prompted(keeper: TmuxKeeper, name: str) -> None:
    """Waits until the shell of a Terminal shows its prompt: keys typed while its profile runs
    may be lost."""
    eventually(lambda: everything_shown(keeper, name).rstrip().endswith("$"))


def everything_shown(keeper: TmuxKeeper, name: str) -> str:
    """The text of a pane, its scrollback included."""
    return tmux(keeper, "capture-pane", "-p", "-J", "-S", "-", "-t", f"={name}:")


@pytest.mark.parametrize("status", [0, 3, 127])
def test_a_command_that_exits_stays_with_its_screen(
    keeper: TmuxKeeper, tmp_path: Path, status: int
) -> None:
    before = time.time()
    new(keeper, "build", tmp_path, "sh", "-c", f"echo built; sleep 0.2; exit {status}")
    found = ending(keeper, "build")
    assert (found.status, found.signal) == (status, None)
    if says_signals(keeper):
        assert found.at is not None
        assert before - 1 <= found.at.timestamp() <= time.time() + 1
    else:
        assert found.at is None
    assert "built" in everything_shown(keeper, "build")
    time.sleep(0.3)
    assert keeper.session("build").ending == found  # it stays


@pytest.mark.parametrize("wrapper", ["env", "systemd-run"])
def test_no_program_while_a_wrapper_starts_it(
    keeper: TmuxKeeper, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, wrapper: str
) -> None:
    """tmux gives the wrapper that starts the program of a pane until it becomes the program:
    caught at that moment, as by tmux listing it instead."""
    new(keeper, "api", tmp_path, "sleep", "30")
    eventually(lambda: keeper.session("api").program == "sleep")
    client = keeper._client  # noqa: SLF001  # pyright: ignore[reportPrivateUsage]

    def starting(
        *args: str, env: Mapping[str, str] | None = None, scoped: bool = False
    ) -> subprocess.CompletedProcess[str]:
        result = client(*args, env=env, scoped=scoped)
        if args[0] == "list-panes":
            for separator in ("\t\x1f\t", "\t\\037\t"):
                result.stdout = result.stdout.replace(
                    f"{separator}sleep{separator}", f"{separator}{wrapper}{separator}"
                )
        return result

    monkeypatch.setattr(keeper, "_client", starting)
    assert keeper.session("api").program == ""


def test_an_ended_command_has_no_program(keeper: TmuxKeeper, tmp_path: Path) -> None:
    """tmux gives a dead pane the wrapper it started, not what ran in it."""
    new(keeper, "build", tmp_path, "sh", "-c", "exit 3")
    ending(keeper, "build")
    assert keeper.session("build").program == ""


def test_a_command_that_ends_at_once_stays(keeper: TmuxKeeper, tmp_path: Path) -> None:
    """Also when it ends before tmux is done creating it: e.g. a typo, whose message shows."""
    created = new(keeper, "typo", tmp_path, "no-such-program-hephaistos")
    assert created.name == "typo"
    assert ending(keeper, "typo").status == 127
    assert "no-such-program-hephaistos" in everything_shown(keeper, "typo")


@pytest.mark.parametrize(
    "keys",
    [
        ["exit", "Enter"],  # status 0
        ["false; exit", "Enter"],  # the status of the last command, 1
        ["exit 3", "Enter"],
        ["false", "Enter", "C-d"],  # Ctrl+D after a failed command: status 1
        ["exec sh -c 'exit 5'", "Enter"],  # a program that replaced the shell
    ],
)
def test_a_shell_that_exits_closes(keeper: TmuxKeeper, tmp_path: Path, keys: list[str]) -> None:
    """As a terminal emulator closes the tab, whatever the status: only a signal keeps it."""
    new(keeper, "sh", tmp_path, SHELL="/bin/sh")
    new(keeper, "other", tmp_path, SHELL="/bin/sh")
    prompted(keeper, "sh")
    for key in keys:
        tmux(keeper, "send-keys", "-t", "=sh:", key)
    assert closed(keeper, "sh")
    assert [session.name for session in keeper.sessions()] == ["other"]


@pytest.mark.parametrize("command", [False, True])
def test_one_a_signal_ended_stays(keeper: TmuxKeeper, tmp_path: Path, command: bool) -> None:  # noqa: FBT001
    """A shell or a command: so that one killed, e.g. by the OOM killer, is seen."""
    run = ("sh", "-c", "exec sleep 600") if command else ()
    session = new(keeper, "victim", tmp_path, *run, SHELL="/bin/sh")
    assert session.pid is not None
    os.kill(session.pid, signal.SIGKILL)
    found = ending(keeper, "victim")
    assert found.status is None
    assert found.signal == (signal.SIGKILL if says_signals(keeper) else None)
    time.sleep(0.3)
    assert keeper.session("victim").ending == found


def test_a_session_made_by_hand_counts_as_a_shell(keeper: TmuxKeeper, tmp_path: Path) -> None:
    new(keeper, "ours", tmp_path, "sh", "-c", "exit 1")  # our server runs, with our config
    tmux(keeper, "new-session", "-d", "-s", "mine", "sh -c 'sleep 0.2; exit 1'")
    assert closed(keeper, "mine")
    assert ending(keeper, "ours").status == 1


def test_a_pane_split_by_hand_closes_alone(keeper: TmuxKeeper, tmp_path: Path) -> None:
    """A shell in a pane added by hand closes when it exits, as tmux does; the Terminal stays."""
    new(keeper, "api", tmp_path, "sleep", "600")
    tmux(keeper, "split-window", "-t", "=api:", "sh -c 'sleep 0.2; exit 1'")
    assert keeper.session("api").panes == 2
    assert eventually(lambda: keeper.session("api").panes == 1)
    assert keeper.session("api").ending is None


def test_a_command_split_by_hand_keeps_the_first_pane(keeper: TmuxKeeper, tmp_path: Path) -> None:
    """The first pane counts: one of a command that ended stays so beside a pane added by hand."""
    new(keeper, "build", tmp_path, "sh", "-c", "sleep 0.5; exit 2")
    tmux(keeper, "split-window", "-t", "=build:", "sleep 600")
    assert ending(keeper, "build").status == 2
    assert keeper.session("build").panes == 2


def test_ended_ones_are_renamed_and_killed(keeper: TmuxKeeper, tmp_path: Path) -> None:
    new(keeper, "a", tmp_path, "true")
    new(keeper, "b", tmp_path, "true")
    ending(keeper, "a")
    ending(keeper, "b")
    keeper.rename("a", "c")
    assert keeper.session("c").ending is not None
    keeper.kill("c")
    keeper.kill("b", force=True)  # with no process left to SIGKILL
    assert keeper.sessions() == []
    with pytest.raises(NoSuchSessionError):
        keeper.kill("b")


def test_kill_with_force_of_an_ended_one_ends_what_it_left(
    keeper: TmuxKeeper, tmp_path: Path
) -> None:
    """A command may end and leave a process behind, e.g. started with `setsid`, which keeps
    running in its scope; `force` ends that too, where tmux still says its process."""
    script = f"setsid sleep 1002 & echo $! > {tmp_path}/pid; exit 4"
    new(keeper, "left", tmp_path, "sh", "-c", script)
    pid = int(written(tmp_path / "pid"))
    assert ending(keeper, "left").status == 4
    keeper.kill("left", force=True)
    assert keeper.sessions() == []
    if not gone(pid):  # tmux 3.8 forgets the process of a dead pane, and so its kin
        os.kill(pid, signal.SIGKILL)


def test_shells_that_exit_close_one_after_another(keeper: TmuxKeeper, tmp_path: Path) -> None:
    """Also with a tmux that misses the end of some (tmux before 3.6, built with utempter, e.g.
    that of Ubuntu): about one in five stayed dead, blank, without the job that reaps for it."""
    for n in range(15):
        new(keeper, f"sh{n}", tmp_path, SHELL="/bin/sh")
        prompted(keeper, f"sh{n}")
        tmux(keeper, "send-keys", "-t", f"=sh{n}:", "exit 3", "Enter")
        assert closed(keeper, f"sh{n}")


def reaping_jobs(keeper: TmuxKeeper) -> list[str]:
    """What the children of the server run that reap for it."""
    server = tmux(keeper, "display-message", "-p", "#{pid}").strip()
    found = subprocess.run(
        ["ps", "--ppid", server, "-o", "args="], capture_output=True, text=True, check=False
    )
    return [line for line in found.stdout.splitlines() if "kill -s CHLD" in line]


def test_one_job_reaps_for_an_old_tmux(keeper: TmuxKeeper, tmp_path: Path) -> None:
    new(keeper, "api", tmp_path)
    expected = 1 if installation(keeper.binary).may_miss_exits else 0
    tmux(keeper, "source-file", str(keeper.config_file))  # as when the config changes
    tmux(keeper, "set-option", "-g", CONFIG_OPTION, "outdated")
    keeper.sessions()  # loads it again
    assert eventually(lambda: len(reaping_jobs(keeper)) == expected or None) is not None
    time.sleep(0.2)
    assert len(reaping_jobs(keeper)) == expected


def test_the_config_reaps_only_where_asked() -> None:
    assert "kill -s CHLD" not in config_text(10)
    assert "kill -s CHLD" in config_text(10, reaping=True)
    assert config_digest(config_text(10)) != config_digest(config_text(10, reaping=True))


def test_the_config_closes_dead_panes_by_ctrl_d_and_says_so_where_asked() -> None:
    binding = 'bind -n C-d if-shell -F "#{pane_dead}" kill-pane "send-keys C-d"'
    assert binding in config_text(10)
    assert "remain-on-exit-format" not in config_text(10)
    assert "press Ctrl+D to close it" in config_text(10, hinting=True)
    assert config_digest(config_text(10)) != config_digest(config_text(10, hinting=True))


@pytest.mark.parametrize(
    ("text", "hints"),
    [("tmux 3.2a", False), ("tmux 3.3", True), ("tmux 3.4", True), ("tmux master", True)],
)
def test_hints_from_3_3(text: str, hints: bool) -> None:  # noqa: FBT001
    assert Installation("tmux", text).hints is hints


def last_line(keeper: TmuxKeeper, name: str) -> str:
    """The line tmux shows in the dead pane of the Terminal named `name`, once it ended."""
    ending(keeper, name)
    return eventually(lambda: everything_shown(keeper, name).strip().splitlines()[-1])


def check_last_line(keeper: TmuxKeeper, shown: str, said: str, old: str) -> None:
    """With tmux 3.3 or later, our line: `said`, when, and the hint; else that of tmux, `old`."""
    if installation(keeper.binary).hints:
        when = r"\d{4}-\d\d-\d\d \d\d:\d\d"
        assert re.fullmatch(rf"{said} at {when}; press Ctrl\+D to close it", shown), shown
    else:
        assert shown.startswith(f"Pane is dead ({old}"), shown
        assert "Ctrl+D" not in shown


@pytest.mark.parametrize(
    ("script", "said", "old"),
    [
        ("echo built; exit 0", "Command finished", "status 0"),
        ("echo built; exit 3", "Command exited with status 3", "status 3"),
        ("kill -9 $$", "Command ended by signal 9", ""),  # 3.2a gives no status, nor signal
    ],
)
def test_a_dead_pane_says_what_ended_how_and_when(
    keeper: TmuxKeeper, tmp_path: Path, script: str, said: str, old: str
) -> None:
    """And that Ctrl+D closes it; tmux before 3.3 shows its own line, without either."""
    new(keeper, "build", tmp_path, "sh", "-c", script)
    check_last_line(keeper, last_line(keeper, "build"), said, old)


def test_a_dead_pane_says_a_shell_ended_by_a_signal(keeper: TmuxKeeper, tmp_path: Path) -> None:
    new(keeper, "sh", tmp_path)
    pid = eventually(lambda: keeper.session("sh").pid)
    assert pid is not None
    os.kill(pid, signal.SIGKILL)
    check_last_line(keeper, last_line(keeper, "sh"), "Shell ended by signal 9", "")


def test_the_date_on_the_line_is_that_of_the_end(keeper: TmuxKeeper, tmp_path: Path) -> None:
    if not installation(keeper.binary).hints:
        pytest.skip("tmux before 3.3 shows its own line")
    new(keeper, "build", tmp_path, "sh", "-c", "exit 3")
    found = ending(keeper, "build")
    assert found.at is not None
    expected = found.at.astimezone().strftime("%Y-%m-%d %H:%M")
    assert f" at {expected};" in last_line(keeper, "build")


def test_a_server_started_by_hand_keeps_ended_commands_once_ours_is_loaded(
    keeper: TmuxKeeper, tmp_path: Path
) -> None:
    tmux(keeper, "new-session", "-d", "-s", "mine", "-c", str(tmp_path))
    assert option(keeper, "remain-on-exit") == "off"  # the default of tmux

    def ctrl_d() -> list[str]:  # the whole table: tmux 3.7 lists nothing for a key given
        bound = tmux(keeper, "list-keys", "-T", "root").splitlines()
        return [line for line in bound if line.split()[3:4] == ["C-d"]]

    assert ctrl_d() == []  # the default of tmux
    keeper.sessions()
    assert option(keeper, "remain-on-exit") == "on"
    assert "kill-pane" in " ".join(ctrl_d())  # Ctrl+D closes them
    new(keeper, "build", tmp_path, "sh", "-c", "exit 6")
    assert ending(keeper, "build").status == 6


def test_ended_and_running_ones_list_together(keeper: TmuxKeeper, tmp_path: Path) -> None:
    for n in range(10):
        new(keeper, f"t{n}", tmp_path, *(("sh", "-c", f"exit {n}") if n % 2 else ("sleep", "600")))
    eventually(lambda: sum(s.ending is not None for s in keeper.sessions()) == 5)
    listing = keeper.listing()
    assert listing.unreadable == frozenset()
    statuses = {s.name: None if s.ending is None else s.ending.status for s in listing.sessions}
    assert statuses == {f"t{n}": n if n % 2 else None for n in range(10)}


def fake_tmux(tmp_path: Path, script: str) -> str:
    path = tmp_path / "tmux"
    path.write_text(f"#!/bin/sh\n{script}\n")
    path.chmod(0o755)
    return str(path)


def with_binary(keeper: TmuxKeeper, binary: str, timeout: float = 5.0) -> TmuxKeeper:
    return TmuxKeeper(
        binary=binary,
        socket=keeper.socket,
        config_file=keeper.config_file,
        history=10,
        detect_scopes=lambda: None,
        timeout=timeout,
    )


def test_no_decision_rests_on_the_messages_of_tmux(keeper: TmuxKeeper, tmp_path: Path) -> None:
    """With every message of tmux replaced by nonsense, each failure means the same."""
    real = keeper.binary
    script = (
        f'"{real}" "$@" 2>/dev/null; status=$?; [ $status = 0 ] || echo "x y z" >&2; exit $status'
    )
    garbled = with_binary(keeper, fake_tmux(tmp_path, script))
    assert garbled.sessions() == []  # no server
    assert not garbled.running()
    new(garbled, "api", tmp_path)
    new(garbled, "web", tmp_path)
    with pytest.raises(NameTakenError):
        new(garbled, "api", tmp_path)
    with pytest.raises(NameTakenError):
        garbled.rename("api", "web")
    garbled.kill("web")
    assert [session.name for session in garbled.sessions()] == ["api"]
    garbled.kill("api")
    assert garbled.sessions() == []  # a server without sessions
    assert garbled.running()
    tmux(keeper, "kill-server")
    eventually(lambda: not garbled.running())  # its socket left behind, refusing connections
    assert keeper.socket_path.exists()
    assert garbled.sessions() == []


def test_a_session_gone_between_listing_and_acting(
    keeper: TmuxKeeper, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    new(keeper, "api", tmp_path)
    listed = keeper.session("api")
    tmux(keeper, "kill-session", "-t", listed.key)  # by another process, meanwhile

    def as_listed_before(_: str) -> Session:
        return listed

    monkeypatch.setattr(keeper, "session", as_listed_before)
    with pytest.raises(NoSuchSessionError):
        keeper.kill("api")
    keeper.kill("api", force=True)  # gone: as forced
    with pytest.raises(NoSuchSessionError):
        keeper.rename("api", "web")
    assert keeper.adopt(listed, uuid.uuid4()) is None


def test_tmux_missing(keeper: TmuxKeeper, tmp_path: Path) -> None:
    missing = with_binary(keeper, str(tmp_path / "no-tmux"))
    with pytest.raises(KeeperError, match=r"tmux is not installed .*terminals\.tmux\.path"):
        missing.sessions()


def test_tmux_too_old(keeper: TmuxKeeper, tmp_path: Path) -> None:
    old = with_binary(keeper, fake_tmux(tmp_path, "echo tmux 3.1"))
    with pytest.raises(KeeperError, match=r"tmux 3\.1 is too old: terminals need tmux 3\.2a"):
        old.sessions()


def test_an_unknown_version_counts_as_new(keeper: TmuxKeeper, tmp_path: Path) -> None:
    real = keeper.binary
    script = f'[ "$1" = -V ] && echo tmux master && exit; exec {real} "$@"'
    master = with_binary(keeper, fake_tmux(tmp_path, script))
    assert master.sessions() == []


def test_a_tmux_hanging_on_its_version(tmp_path: Path) -> None:
    """Said as for any command of tmux, not as Python says a timeout."""
    with pytest.raises(KeeperError, match=r"^tmux did not answer within 0\.3 s$"):
        installation(fake_tmux(tmp_path, "exec sleep 10"), timeout=0.3)


def test_a_hanging_tmux(keeper: TmuxKeeper, tmp_path: Path) -> None:
    script = '[ "$1" = -V ] && echo tmux 3.4 && exit; exec sleep 10'
    hanging = with_binary(keeper, fake_tmux(tmp_path, script), timeout=0.3)
    with pytest.raises(KeeperError, match=r"tmux did not answer within 0\.3 s"):
        hanging.sessions()


def test_scopes_of_their_own(systemd_keeper: TmuxKeeper, tmp_path: Path) -> None:
    created = new(systemd_keeper, "api", tmp_path, "sleep", "60")
    server = scope_of(int(tmux(systemd_keeper, "display-message", "-p", "#{pid}")))
    assert server is not None
    assert server != scope_of(os.getpid())

    def own() -> str:
        unit = scope_of(created.pid)
        return unit if unit is not None and unit not in (server, scope_of(os.getpid())) else ""

    # Never one that tmux makes, as on Ubuntu, see `NO_BUS`.
    unit = eventually(own)
    assert unit == f"hephaistos-terminal-{created.terminal_id}.scope"
    systemd_keeper.kill("api")

    def ended() -> bool:
        command = ["systemctl", "--user", "is-active", unit]
        result = subprocess.run(command, capture_output=True, text=True, check=False)
        return result.stdout.strip() != "active"

    eventually(ended)


def test_the_server_has_no_session_bus(systemd_keeper: TmuxKeeper, tmp_path: Path) -> None:
    new(systemd_keeper, "api", tmp_path, "sleep", "60")
    pid = tmux(systemd_keeper, "display-message", "-p", "#{pid}").strip()
    variables = Path(f"/proc/{pid}/environ").read_bytes().split(b"\0")
    assert f"{BUS_VARIABLE}={NO_BUS}".encode() in variables


def test_a_terminal_has_the_session_bus_of_its_creator(
    systemd_keeper: TmuxKeeper, tmp_path: Path
) -> None:
    script = f'printf "%s\\n" "${{{BUS_VARIABLE}-unset}}" > out; exec sleep 60'
    new(systemd_keeper, "api", tmp_path, "sh", "-c", script, **{BUS_VARIABLE: "unix:path=/mine"})
    assert written(tmp_path / "out") == "unix:path=/mine\n"


def test_a_terminal_has_the_session_bus_of_the_manager_where_its_creator_has_none(
    systemd_keeper: TmuxKeeper, tmp_path: Path
) -> None:
    assert systemd_keeper.scopes is not None
    expected = systemd_keeper.scopes.environment.get(BUS_VARIABLE, "unset")
    script = f'printf "%s\\n" "${{{BUS_VARIABLE}-unset}}" > out; exec sleep 60'
    new(systemd_keeper, "api", tmp_path, "sh", "-c", script)
    assert written(tmp_path / "out") == f"{expected}\n"


def test_a_terminal_has_no_session_bus_where_none_is_known(
    keeper: TmuxKeeper, tmp_path: Path
) -> None:
    assert keeper.scopes is None  # and the server has the bus of the tests, which leads nowhere
    script = f'printf "%s\\n" "${{{BUS_VARIABLE}-unset}}" > out; exec sleep 60'
    new(keeper, "api", tmp_path, "sh", "-c", script)
    assert written(tmp_path / "out") == "unset\n"


def test_kill_with_force_spares_the_server(systemd_keeper: TmuxKeeper, tmp_path: Path) -> None:
    other = new(systemd_keeper, "other", tmp_path, "sleep", "60")
    # Started by hand: without our scope, and in that of the server where tmux makes none (as the
    # tmux from conda).
    tmux(systemd_keeper, "new-session", "-d", "-s", "mine", "sleep 60")
    systemd_keeper.kill("mine", force=True)
    assert [session.name for session in systemd_keeper.sessions()] == ["other"]
    assert other.pid is not None
    assert not gone(other.pid)


def test_systemds_environment(
    systemd_keeper: TmuxKeeper, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("VIRTUAL_ENV", "/a/venv")  # e.g. from `uv run`
    script = 'printf "%s\\n" "${VIRTUAL_ENV-unset}" > out; exec sleep 60'
    new(systemd_keeper, "api", tmp_path, "sh", "-c", script)
    assert written(tmp_path / "out") == "unset\n"


def test_kill_with_force_in_a_scope(systemd_keeper: TmuxKeeper, tmp_path: Path) -> None:
    pids = stubborn(systemd_keeper, tmp_path)
    systemd_keeper.kill("stubborn", force=True)
    eventually(lambda: all(map(gone, pids)))
