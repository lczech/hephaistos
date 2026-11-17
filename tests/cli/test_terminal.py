import json
import shlex
import subprocess
import sys
import time
import uuid
from collections.abc import Iterator, Mapping, Sequence
from pathlib import Path

import pytest
from typer.testing import CliRunner

from hephaistos.cli import terminal as terminal_cli
from hephaistos.cli import tty
from hephaistos.cli.main import app
from hephaistos.core.db.sessions import write_session
from hephaistos.core.observers import terminals as observer
from hephaistos.core.observers.terminals import Result
from hephaistos.core.state import terminals
from hephaistos.core.terminals.keeper import Session
from hephaistos.core.terminals.tmux import TmuxKeeper, installation
from hephaistos.core.utils.paths import Paths
from support import clone, create, eventually, git, slow_scopes

pytestmark = pytest.mark.tmux

runner = CliRunner()


@pytest.fixture(autouse=True)
def set_up(keeper: TmuxKeeper) -> None:
    """Set up, with a tmux socket of this test alone, its server ended afterwards."""
    del keeper
    runner.invoke(app, ["setup", "--name", "laptop"])


@pytest.fixture
def proj(tmp_path: Path) -> Path:
    """A registered Clone of Repository `proj`, with Worktree `feature` inside it."""
    path = clone(create(tmp_path / "source"), tmp_path / "proj")
    git(path, "worktree", "add", "--quiet", "-b", "feature", str(path / ".worktrees" / "feature"))
    result = runner.invoke(app, ["clone", "register", str(path), "--repo", "proj", "--yes"])
    assert result.exit_code == 0, result.output
    return path


def ok(*args: str) -> list[str]:
    result = runner.invoke(app, ["terminal", *args])
    assert result.exit_code == 0, result.output
    return result.stdout.splitlines()


def failed(*args: str) -> str:
    result = runner.invoke(app, ["terminal", *args])
    assert result.exit_code == 1, result.output
    return str(result.exception)


def test_create(proj: Path) -> None:
    assert ok("create", "--dir", str(proj)) == [
        f"Created terminal proj-1 in {proj}",
        "  attach with: hephaistos terminal attach proj-1",
    ]
    lines = ok("create", "-n", "build", "-d", str(proj), "--", "sh", "-c", "exec sleep 60")
    assert lines[0] == f"Created terminal build in {proj}, with command: sh -c 'exec sleep 60'"


def test_a_command_without_dashes(proj: Path) -> None:
    ok("create", "-d", str(proj), "sleep", "60")
    assert json.loads("\n".join(ok("show", "proj-1", "--json")))["command"] == ["sleep", "60"]


def test_options_after_the_command_are_its_own(proj: Path) -> None:
    ok("create", "-d", str(proj), "sh", "-c", "exec sleep 60", "-n", "x")
    assert json.loads("\n".join(ok("show", "proj-1", "--json")))["command"][-2:] == ["-n", "x"]


def test_list(proj: Path, tmp_path: Path) -> None:
    ok("create", "-d", str(proj))
    ok("create", "-d", str(proj / ".worktrees" / "feature"), "-n", "feat")
    ok("create", "-d", str(tmp_path), "-n", "elsewhere", "--", "sleep", "60")
    lines = ok("list")
    assert lines[0].split() == [
        "name",
        "status",
        "repo",
        "directory",
        "program",
        "attached",
        "active",
    ]
    rows = [line.split() for line in lines[1:]]
    assert [row[:4] for row in rows] == [
        ["elsewhere", "open", "-", str(tmp_path)],
        ["feat", "open", "proj", str(proj / ".worktrees" / "feature")],
        ["proj-1", "open", "proj", str(proj)],
    ]
    assert rows[0][4:] == ["sleep", "-", "now"]


def test_list_sorts_numbers_as_numbers(tmp_path: Path) -> None:
    for name in ("t-10", "t-2", "t-1"):
        ok("create", "-n", name, "-d", str(tmp_path))
    assert [line.split()[0] for line in ok("list")[1:]] == ["t-1", "t-2", "t-10"]


def test_odd_names_and_directories_are_escaped(tmp_path: Path) -> None:
    (tmp_path / "new\nline").mkdir()
    ok("create", "-d", str(tmp_path / "new\nline"), "-n", "odd")
    [_, row] = ok("list")
    assert f"{tmp_path}/new\\nline" in row
    data = json.loads("\n".join(ok("list", "--json")))
    assert data[0]["directory"] == str(tmp_path / "new\nline")


def test_show(proj: Path) -> None:
    worktree = proj / ".worktrees" / "feature"
    ok("create", "-d", str(worktree), "-n", "feat")
    fields = dict(line.split(None, 1) for line in ok("show", "feat"))
    assert fields["status"] == "open"
    assert (fields["directory"], fields["current"]) == (str(worktree), str(worktree))
    assert (fields["command"], fields["attached"]) == ("-", "0")
    assert (fields["repository"], fields["checkout"]) == ("proj", str(worktree))
    assert "panes" not in fields
    data = json.loads("\n".join(ok("show", "feat", "--json")))
    assert data["checkout"]["repository"]["name"] == "proj"
    assert data["checkout"]["clone"]["path"] == str(proj)
    assert data["checkout"]["worktree"]["name"] == "feature"
    assert data["observed_by"]["name"] == "laptop"


def test_show_a_split_one(keeper: TmuxKeeper, tmp_path: Path) -> None:
    ok("create", "-n", "api", "-d", str(tmp_path))
    subprocess.run([keeper.binary, "-L", keeper.socket, "split-window", "-t", "=api:"], check=True)
    assert "panes       2" in ok("show", "api")


def test_unknown_ones() -> None:
    for args in (("show", "x"), ("rename", "x", "y"), ("close", "x"), ("kill", "x")):
        assert failed(*args) == "no terminal named x on this machine"


def test_rename_close_and_kill(tmp_path: Path) -> None:
    ok("create", "-n", "api", "-d", str(tmp_path))
    assert ok("rename", "api", "web") == ["Renamed terminal api to web"]
    assert ok("close", "web") == ["Closed terminal web"]
    ok("create", "-n", "stubborn", "-d", str(tmp_path), "--", "sh", "-c", "trap '' HUP; sleep 600")
    assert ok("kill", "stubborn") == ["Killed terminal stubborn"]
    assert ok("list") == ["name  status  repo  directory  program  attached  active"]


@pytest.mark.parametrize("command", ["close", "kill"])
def test_close_a_lost_one(keeper: TmuxKeeper, tmp_path: Path, command: str) -> None:
    """Nothing is left to close, so it is removed."""
    ok("create", "-n", "api", "-d", str(tmp_path))
    subprocess.run([keeper.binary, "-L", keeper.socket, "kill-server"], check=True)
    assert ok("list")[1].split()[:5] == ["api", "lost", "(tmux", "server", "ended)"]
    assert ok(command, "api") == ["Removed lost terminal api"]


def test_list_says_why_one_was_lost(paths: Paths, keeper: TmuxKeeper, tmp_path: Path) -> None:
    """As it says how one ended."""
    ok("create", "-n", "api", "-d", str(tmp_path))
    with write_session(paths) as session:  # as if seen last in another boot
        state = terminals.by_name(session, "api")
        session.conn.execute(
            "UPDATE state_terminals SET boot_id = 'before' WHERE id = ?", (state.id.bytes,)
        )
    kill_server(keeper)
    assert ok("list")[1].split()[:4] == ["api", "lost", "(machine", "restarted)"]


def test_unobserved_ones_show_when_they_last_were(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ok("create", "-n", "api", "-d", str(tmp_path))
    seen = ok("show", "api", "--time-format", "full")
    [observed] = [line.split(None, 1)[1] for line in seen if line.startswith("observed ")]

    def unobserved(paths: Paths) -> Result:
        del paths
        return Result(None, "tmux is gone")

    monkeypatch.setattr(observer, "observe", unobserved)
    for args in (["list"], ["list", "--json"], ["show", "api"]):
        result = runner.invoke(app, ["terminal", *args])
        assert result.exit_code == 0, result.output
        assert result.stderr == (
            f"terminals not observed: tmux is gone; showing them as last observed, at {observed}\n"
        )


def test_errors_are_messages(tmp_path: Path) -> None:
    ok("create", "-n", "api", "-d", str(tmp_path))
    assert failed("create", "-n", "api", "-d", str(tmp_path)) == (
        "a terminal named api exists; choose another name"
    )
    assert failed("create", "-n", "a.b", "-d", str(tmp_path)).startswith(
        "'a.b' is not a terminal name"
    )
    assert failed("create", "-d", str(tmp_path / "missing")) == f"no directory {tmp_path}/missing"


def test_list_many_quickly(keeper: TmuxKeeper, tmp_path: Path) -> None:
    for batch in range(0, 200, 25):
        commands: list[str] = []
        for n in range(batch, batch + 25):
            commands += ["new-session", "-d", "-s", f"t{n}", "-c", str(tmp_path), ";"]
        subprocess.run([keeper.binary, "-L", keeper.socket, *commands[:-1]], check=True)
    ok("list")  # adopts them all
    start = time.monotonic()
    assert len(ok("list")) == 201
    assert time.monotonic() - start < 3


class Exec:
    """Stands in for `os.execvp`: records the command the CLI would become."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.commands: list[list[str]] = []
        monkeypatch.setattr(terminal_cli.os, "execvp", self)
        monkeypatch.setattr(tty, "attachable", lambda: True)

    def __call__(self, file: str, args: list[str]) -> None:
        assert file == args[0]
        self.commands.append(args)
        raise SystemExit(0)  # as the process would be replaced


def test_attach_needs_a_terminal_emulator(proj: Path) -> None:
    ok("create", "-d", str(proj))
    assert failed("attach", "proj-1") == (
        "this command attaches only when run interactively; run it in a terminal emulator"
    )


def test_attach_becomes_tmux(
    keeper: TmuxKeeper, proj: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ok("create", "-d", str(proj))
    becomes = Exec(monkeypatch)
    ok("attach", "proj-1")
    key = keeper.session("proj-1").key
    assert becomes.commands == [
        [keeper.binary, "-u", "-L", keeper.socket, "-f", str(keeper.config_file),
         "attach-session", "-t", key],
    ]  # fmt: skip


def test_create_attaches_unless_detached(
    keeper: TmuxKeeper, proj: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    becomes = Exec(monkeypatch)
    assert ok("create", "-d", str(proj)) == []  # it became tmux, printing nothing
    assert becomes.commands[0][-2:] == ["-t", keeper.session("proj-1").key]
    lines = ok("create", "-d", str(proj), "--detached")
    assert lines[0] == f"Created terminal proj-2 in {proj}"
    assert len(becomes.commands) == 1


def test_attach_needs_both_ends_the_tty(monkeypatch: pytest.MonkeyPatch) -> None:
    class Stream:
        def __init__(self, *, tty: bool) -> None:
            self.tty = tty

        def isatty(self) -> bool:
            return self.tty

    for stdin, stdout in [(True, False), (False, True)]:
        monkeypatch.setattr(tty.sys, "stdin", Stream(tty=stdin))
        monkeypatch.setattr(tty.sys, "stdout", Stream(tty=stdout))
        assert not tty.attachable()
    monkeypatch.setattr(tty.sys, "stdout", Stream(tty=True))
    monkeypatch.setattr(tty.sys, "stdin", Stream(tty=True))
    assert tty.attachable()


def cli_text(*args: str) -> str:
    """The CLI with `args`, as a shell command: as a user would type it."""
    return shlex.join([sys.executable, "-c", "from hephaistos.cli.main import run; run()", *args])


def test_attach_inside_the_terminal_itself(keeper: TmuxKeeper, proj: Path, tmp_path: Path) -> None:
    ok("create", "-d", str(proj), "-n", "api", "--detached", "--", "sh")
    said = tmp_path / "said"
    typed = f"{cli_text('terminal', 'attach', 'api')} 2> {said}.part; mv {said}.part {said}"
    target = keeper.session("api").key
    command = [keeper.binary, "-L", keeper.socket, "send-keys", "-t", target]
    subprocess.run([*command, "-l", typed], check=True)
    subprocess.run([*command, "Enter"], check=True)
    eventually(said.exists)
    assert said.read_text() == (
        "error: this runs inside terminal api; attach to it from another terminal emulator\n"
    )


class Outer:
    """A terminal emulator for the tests: a tmux of its own, without a prefix of its own, so
    that every key reaches what runs in it."""

    def __init__(self, keeper: TmuxKeeper, tmp_path: Path) -> None:
        self.binary = keeper.binary
        self.socket = f"{keeper.socket}-outer"
        self.socket_path = keeper.socket_path.with_name(self.socket)
        self.out = tmp_path / "outer-done"

    def tmux(self, *args: str) -> str:
        command = [self.binary, "-L", self.socket, "-f", "/dev/null", *args]
        return subprocess.run(command, capture_output=True, text=True, check=True).stdout

    def run(self, *args: str, in_tmux: bool = False, spread: str | None = None) -> None:
        """Runs the CLI in it, as a user would type it: with nothing of tmux in its environment,
        unless `in_tmux`, as in a tmux of the user; `spread` is a `HEPHAISTOS_TERMINAL` there."""
        unset = "" if in_tmux else "-u TMUX -u TMUX_PANE"
        variable = "" if spread is None else f"HEPHAISTOS_TERMINAL={spread}"
        script = f"env {unset} {variable} {cli_text(*args)}; echo done > {self.out}; exec sleep 600"
        self.tmux("new-session", "-d", "-x", "100", "-y", "30", "-s", "outer", script)
        self.tmux("set", "-g", "prefix", "None")

    def screen(self) -> str:
        return self.tmux("capture-pane", "-p", "-t", "=outer:")

    def end(self) -> None:
        """Ends its server, and removes its socket, which tmux leaves."""
        command = [self.binary, "-L", self.socket, "kill-server"]
        subprocess.run(command, capture_output=True, check=False)
        self.socket_path.unlink(missing_ok=True)


@pytest.fixture
def outer(keeper: TmuxKeeper, tmp_path: Path) -> Iterator[Outer]:
    found = Outer(keeper, tmp_path)
    yield found
    found.end()


def test_attach_is_plain_tmux(outer: Outer, proj: Path) -> None:
    ok("create", "-d", str(proj), "-n", "api", "--", "sh", "-c", "echo hello there; exec sleep 600")
    outer.run("terminal", "attach", "api")
    eventually(lambda: "hello there" in outer.screen())
    assert eventually(lambda: "[api]" in outer.screen().splitlines()[-1])  # the bar of tmux
    outer.tmux("send-keys", "-t", "=outer:", "C-b", "d")  # the keys of tmux: detach
    eventually(outer.out.exists)
    assert "[detached (from session api)]" in outer.screen()
    assert ok("show", "api")[0].split() == ["name", "api"]  # still running


def test_attach_restores_a_lost_one(keeper: TmuxKeeper, outer: Outer, proj: Path) -> None:
    ok("create", "-d", str(proj), "-n", "api", "--", "sleep", "600")
    subprocess.run([keeper.binary, "-L", keeper.socket, "kill-server"], check=True)
    outer.run("terminal", "attach", "api")
    eventually(lambda: "restored after the tmux server ended: found lost at" in outer.screen())
    assert "earlier output is gone" in outer.screen()
    assert "it ran: sleep 600" in outer.screen()
    assert ok("list")[1].split()[:2] == ["api", "open"]


def test_attach_from_a_tmux_of_the_user(outer: Outer, proj: Path) -> None:
    """tmux attaches from a pane of another server; so do we, also where `HEPHAISTOS_TERMINAL`
    spread into it, as into a tmux of the user whose server started inside the Terminal."""
    ok("create", "-d", str(proj), "-n", "api", "--", "sh", "-c", "echo hello there; exec sleep 600")
    shown = json.loads(runner.invoke(app, ["terminal", "show", "api", "--json"]).stdout)
    # TMUX names the socket of the outer one.
    outer.run("terminal", "attach", "api", in_tmux=True, spread=shown["id"])
    eventually(lambda: "hello there" in outer.screen())


# Ended ones, and those whose session went.


def kill_server(keeper: TmuxKeeper) -> None:
    subprocess.run([keeper.binary, "-L", keeper.socket, "kill-server"], check=True)


@pytest.fixture
def settled(keeper: TmuxKeeper, monkeypatch: pytest.MonkeyPatch) -> None:
    """Keepers whose `create` returns once the program it started ended, which it must: so the
    observation after it finds that, whatever the load."""
    create = TmuxKeeper.create

    def created_then_settled(  # noqa: PLR0913, PLR0917 - those of `create`
        self: TmuxKeeper,
        terminal_id: uuid.UUID,
        name: str,
        directory: Path,
        command: Sequence[str] | None,
        environment: Mapping[str, str],
    ) -> Session:
        session = create(self, terminal_id, name, directory, command, environment)
        eventually(lambda: all(s.ending for s in keeper.sessions() if s.name == name) or None)
        return session

    monkeypatch.setattr(TmuxKeeper, "create", created_then_settled)


@pytest.mark.usefixtures("settled")
def test_a_command_that_ended_already(tmp_path: Path) -> None:
    lines = ok("create", "-n", "build", "-d", str(tmp_path), "--", "sh", "-c", "exit 3")
    assert lines == [
        f"Created terminal build in {tmp_path}, with command: sh -c 'exit 3'",
        "  its command exited with status 3",
        "  see its last screen with: hephaistos terminal attach build",
    ]
    assert ok("list")[1].split()[:4] == ["build", "ended", "(status", "3)"]
    fields = dict(line.split(None, 1) for line in ok("show", "build"))
    assert fields["status"] == "ended (status 3)"
    assert "ended" in fields
    assert "noticed" not in fields
    data = json.loads("\n".join(ok("show", "build", "--json")))
    assert (data["status"], data["exit_status"], data["exit_signal"]) == ("ended", 3, None)
    assert data["ended_at"] is not None
    assert (data["lost_at"], data["lost_because"]) == (None, None)


@pytest.mark.usefixtures("settled")
def test_a_shell_that_closed_already(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SHELL", "/bin/false")
    assert failed("create", "-n", "sh", "-d", str(tmp_path), "--detached") == (
        "terminal sh closed: its shell, /bin/false, exited;"
        " check SHELL, or the profile of that shell"
    )
    assert ok("list") == ["name  status  repo  directory  program  attached  active"]


def test_a_command_still_starting(
    keeper: TmuxKeeper, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Said as found: created, with what it was given; it ends a moment later, staying."""
    monkeypatch.setattr(TmuxKeeper, "scopes", slow_scopes(tmp_path))
    lines = ok("create", "-n", "typo", "-d", str(tmp_path), "--", "no-such-program-hephaistos")
    assert lines == [
        f"Created terminal typo in {tmp_path}, with command: no-such-program-hephaistos",
        "  attach with: hephaistos terminal attach typo",
    ]
    eventually(lambda: keeper.session("typo").ending)
    assert ok("list")[1].split()[:3] == ["typo", "ended", "(status"]


def test_one_a_signal_ended(tmp_path: Path) -> None:
    ok("create", "-n", "job", "-d", str(tmp_path), "--", "sh", "-c", "kill -KILL $$")
    said = {"ended (signal 9, SIGKILL)", "ended (signal)"}  # tmux before 3.3 does not say which
    assert any(ok("list")[1].split(None, 1)[1].startswith(status) for status in said)
    fields = dict(line.split(None, 1) for line in ok("show", "job"))
    assert fields["status"] in said


def test_show_says_when_and_why_a_session_went(
    keeper: TmuxKeeper, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ok("create", "-n", "build", "-d", str(tmp_path), "--", "sh", "-c", "exit 3")
    ok("create", "-n", "api", "-d", str(tmp_path))
    kill_server(keeper)
    build = dict(line.split(None, 1) for line in ok("show", "build", "--time-format", "relative"))
    assert (build["status"], build["noticed"]) == ("ended (status 3, screen gone)", "now")
    [listed] = [line for line in ok("list") if line.startswith("build ")]
    assert listed.split(None, 1)[1].startswith("ended (status 3, screen gone)")
    api = dict(line.split(None, 1) for line in ok("show", "api", "--time-format", "relative"))
    assert (api["status"], api["noticed"]) == ("lost (tmux server ended)", "now")
    assert "ended" not in api
    [build_json, api_json] = sorted(
        json.loads("\n".join(ok("list", "--json"))), key=lambda item: item["name"] != "build"
    )
    assert (build_json["status"], build_json["exit_status"]) == ("ended", 3)
    assert (build_json["lost_because"], api_json["lost_because"]) == ("server", "server")
    assert (api_json["status"], api_json["ended_at"]) == ("lost", None)
    assert build_json["lost_at"] is not None
    Exec(monkeypatch)  # as if run interactively
    assert failed("attach", "build") == (
        "terminal build exited with status 3; its last screen is gone, as the tmux server ended"
    )


@pytest.mark.usefixtures("settled")
@pytest.mark.parametrize("command", ["close", "kill"])
def test_close_ended_ones(keeper: TmuxKeeper, tmp_path: Path, command: str) -> None:
    """One closes with its last screen; one whose screen is gone is removed."""
    ok("create", "-n", "a", "-d", str(tmp_path), "--", "true")
    ok("create", "-n", "b", "-d", str(tmp_path), "--", "true")
    assert ok(command, "a") == ["Closed ended terminal a"]
    kill_server(keeper)
    assert ok(command, "b") == ["Removed ended terminal b"]
    assert ok("list") == ["name  status  repo  directory  program  attached  active"]


def test_names_of_ended_ones_stay_taken(tmp_path: Path) -> None:
    ok("create", "-n", "build", "-d", str(tmp_path), "--", "true")
    assert failed("create", "-n", "build", "-d", str(tmp_path)) == (
        "an ended terminal named build exists;"
        " run `hephaistos terminal close build` to close it, or choose another name"
    )


def dead_line(keeper: TmuxKeeper, said: str, old: str) -> str:
    """The start of the line on a dead pane: ours, `said`, with tmux 3.3 or later; else that of
    tmux, as `Pane is dead (<old>`."""
    return said if installation(keeper.binary).hints else f"Pane is dead ({old}"


def shown(keeper: TmuxKeeper, outer: Outer, name: str, text: str) -> bool:
    """Whether `text` shows, attached, or in the scrollback: tmux draws its line on a dead pane by
    scrolling the screen up one line, so the top line, e.g. the only line of output, moves there
    unless a larger client pulls it back."""
    if text in outer.screen():
        return True
    command = [
        keeper.binary,
        "-L",
        keeper.socket,
        "capture-pane",
        "-p",
        "-S",
        "-",
        "-t",
        f"={name}:",
    ]
    return text in subprocess.run(command, capture_output=True, text=True, check=True).stdout


def test_attach_to_an_ended_one_shows_its_last_screen(
    keeper: TmuxKeeper, outer: Outer, tmp_path: Path
) -> None:
    """Plain tmux, with its line on how it ended; typing does nothing, Ctrl+B d leaves."""
    script = "echo all built; exit 3"
    ok("create", "-n", "build", "-d", str(tmp_path), "--", "sh", "-c", script)
    outer.run("terminal", "attach", "build")
    line = dead_line(keeper, "Command exited with status 3", "status 3")
    assert eventually(lambda: line in outer.screen())
    assert shown(keeper, outer, "build", "all built")
    outer.tmux("send-keys", "-t", "=outer:", "-l", "typed")
    time.sleep(0.2)
    assert "typed" not in outer.screen()
    outer.tmux("send-keys", "-t", "=outer:", "C-b", "d")
    eventually(outer.out.exists)
    assert ok("list")[1].split()[:2] == ["build", "ended"]


def test_ctrl_d_closes_an_ended_one(keeper: TmuxKeeper, outer: Outer, tmp_path: Path) -> None:
    """As it closes a shell; tmux 3.3 and later say so on its line."""
    ok("create", "-n", "build", "-d", str(tmp_path), "--", "sh", "-c", "echo all built; exit 3")
    outer.run("terminal", "attach", "build")
    line = dead_line(keeper, "Command exited with status 3", "status 3")
    assert eventually(lambda: line in outer.screen())
    hint = "press Ctrl+D to close it" in outer.screen()
    assert hint is installation(keeper.binary).hints
    outer.tmux("send-keys", "-t", "=outer:", "C-d")
    eventually(outer.out.exists)
    assert "[exited]" in outer.screen()
    assert ok("list") == ["name  status  repo  directory  program  attached  active"]


def test_ctrl_d_reaches_a_running_program(keeper: TmuxKeeper, outer: Outer, tmp_path: Path) -> None:
    """Only a dead pane takes it: a program gets it, e.g. as the end of its input."""
    out = tmp_path / "typed"
    ok("create", "-n", "cat", "-d", str(tmp_path), "--", "sh", "-c", f"exec cat > {out}")
    outer.run("terminal", "attach", "cat")
    eventually(lambda: "[cat]" in outer.screen().splitlines()[-1])  # the bar of tmux
    outer.tmux("send-keys", "-t", "=outer:", "-l", "hello")
    outer.tmux("send-keys", "-t", "=outer:", "Enter", "C-d")
    line = dead_line(keeper, "Command finished", "status 0")
    assert eventually(lambda: line in outer.screen())
    assert out.read_text() == "hello\n"
    assert ok("list")[1].split()[:3] == ["cat", "ended", "(finished)"]
    outer.tmux("send-keys", "-t", "=outer:", "C-d")  # now it closes
    eventually(outer.out.exists)
    assert ok("list") == ["name  status  repo  directory  program  attached  active"]


def test_create_attaches_to_a_command_that_ends_at_once(
    keeper: TmuxKeeper, outer: Outer, tmp_path: Path
) -> None:
    """E.g. a typo: its message shows, as it would in a terminal emulator."""
    outer.run("terminal", "create", "-d", str(tmp_path), "-n", "typo", "--", "mkae-hephaistos")
    line = dead_line(keeper, "Command exited with status 127", "status 127")
    assert eventually(lambda: line in outer.screen())
    assert shown(keeper, outer, "typo", "mkae-hephaistos")


@pytest.mark.parametrize("keys", ["exit 3", "C-d"])
def test_a_shell_that_exits_ends_the_attach(outer: Outer, tmp_path: Path, keys: str) -> None:
    """As a tab of a terminal emulator closes: tmux says it exited, and the CLI ends."""
    ok("create", "-n", "sh", "-d", str(tmp_path), "--detached")
    outer.run("terminal", "attach", "sh")
    eventually(lambda: "[sh]" in outer.screen().splitlines()[-1])  # the bar of tmux
    eventually(lambda: "$" in outer.screen())  # its prompt: keys typed before may be lost
    if keys == "C-d":
        outer.tmux("send-keys", "-t", "=outer:", "C-d")  # reaches the shell: it is not dead
    else:
        outer.tmux("send-keys", "-t", "=outer:", "-l", keys)
        outer.tmux("send-keys", "-t", "=outer:", "Enter")
    eventually(outer.out.exists)
    assert "[exited]" in outer.screen()
    assert ok("list") == ["name  status  repo  directory  program  attached  active"]
