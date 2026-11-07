import os
import signal
import subprocess
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from hephaistos.core.terminals.keeper import (
    KeeperError,
    NameTakenError,
    NoSuchSessionError,
    Session,
)
from hephaistos.core.terminals.tmux import (
    CONFIG_OPTION,
    TmuxKeeper,
    config_digest,
    config_text,
    parse_version,
    scope_of,
    socket_name,
)
from support import eventually

pytestmark = pytest.mark.tmux


def tmux(keeper: TmuxKeeper, *args: str, config: str = "/dev/null") -> str:
    """Runs tmux on the keeper's socket as a user would, with its own config; returns its output."""
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
    """A file's text, once a Terminal's program has written `lines` lines to it."""

    def text() -> str:
        found = path.read_text() if path.exists() else ""
        return found if found.count("\n") >= lines else ""

    return eventually(text)


def gone(pid: int) -> bool:
    """Whether a process ended. A zombie counts: Ubuntu's tmux, built with systemd, sometimes
    reaps a pane's process only when its next child ends."""
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
        ("tmux 3.8_", (3, 8)),  # as conda-forge's builds call some
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
    assert text.endswith(f"set -g {CONFIG_OPTION} {config_digest(text)}\n")
    assert config_digest(text) == config_digest(config_text(1234))
    assert config_digest(text) != config_digest(config_text(99))


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
    assert option(keeper, "status") == "on"
    keeper.sessions()
    assert option(keeper, "status") == "off"
    assert option(keeper, CONFIG_OPTION) == config_digest(keeper.config)


def test_none_of_tmuxs_keys_but_ours(keeper: TmuxKeeper, tmp_path: Path) -> None:
    new(keeper, "api", tmp_path)
    keys = tmux(keeper, "list-keys", "-T", "prefix").splitlines()
    assert sorted(line.split()[3] for line in keys) == ["C-b", "PPage", "[", "d"]
    tmux(keeper, "set-option", "-g", CONFIG_OPTION, "outdated")  # as after a settings change
    keeper.sessions()  # loads it again, which changes nothing else
    assert option(keeper, CONFIG_OPTION) == config_digest(keeper.config)
    assert tmux(keeper, "list-keys", "-T", "prefix").splitlines() == keys


def test_the_users_tmux_config_stays_out(keeper: TmuxKeeper, tmp_path: Path) -> None:
    Path(os.environ["HOME"], ".tmux.conf").write_text("set -g status on\nset -g @theirs 1\n")
    new(keeper, "api", tmp_path)
    assert option(keeper, "status") == "off"
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


def test_tmux_missing(keeper: TmuxKeeper, tmp_path: Path) -> None:
    missing = with_binary(keeper, str(tmp_path / "no-tmux"))
    with pytest.raises(KeeperError, match=r"tmux isn't installed .*terminals\.tmux\.path"):
        missing.sessions()


def test_tmux_too_old(keeper: TmuxKeeper, tmp_path: Path) -> None:
    old = with_binary(keeper, fake_tmux(tmp_path, "echo tmux 3.1"))
    with pytest.raises(KeeperError, match=r"tmux 3\.1 is too old: Terminals need tmux 3\.2a"):
        old.sessions()


def test_an_unknown_version_counts_as_new(keeper: TmuxKeeper, tmp_path: Path) -> None:
    real = keeper.binary
    script = f'[ "$1" = -V ] && echo tmux master && exit; exec {real} "$@"'
    master = with_binary(keeper, fake_tmux(tmp_path, script))
    assert master.sessions() == []


def test_a_hanging_tmux(keeper: TmuxKeeper, tmp_path: Path) -> None:
    script = '[ "$1" = -V ] && echo tmux 3.4 && exit; exec sleep 10'
    hanging = with_binary(keeper, fake_tmux(tmp_path, script), timeout=0.3)
    with pytest.raises(KeeperError, match=r"tmux didn't answer within 0\.3 s"):
        hanging.sessions()


def test_scopes_of_their_own(systemd_keeper: TmuxKeeper, tmp_path: Path) -> None:
    created = new(systemd_keeper, "api", tmp_path, "sleep", "60")
    server = scope_of(int(tmux(systemd_keeper, "display-message", "-p", "#{pid}")))
    assert server is not None
    assert server != scope_of(os.getpid())

    def own() -> str:
        unit = scope_of(created.pid)
        return unit if unit is not None and unit not in (server, scope_of(os.getpid())) else ""

    # Ours, or tmux's own where it is built with systemd support, e.g. Ubuntu's: see `create`.
    unit = eventually(own)
    assert unit == f"hephaistos-terminal-{created.terminal_id}.scope" or unit.startswith(
        "tmux-spawn-"
    )
    systemd_keeper.kill("api")

    def ended() -> bool:
        command = ["systemctl", "--user", "is-active", unit]
        result = subprocess.run(command, capture_output=True, text=True, check=False)
        return result.stdout.strip() != "active"

    eventually(ended)


def test_kill_with_force_spares_the_server(systemd_keeper: TmuxKeeper, tmp_path: Path) -> None:
    other = new(systemd_keeper, "other", tmp_path, "sleep", "60")
    # Started by hand: without our scope, and in the server's where tmux makes none (conda's).
    tmux(systemd_keeper, "new-session", "-d", "-s", "mine", "sleep 60")
    systemd_keeper.kill("mine", force=True)
    assert [session.name for session in systemd_keeper.sessions()] == ["other"]
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
