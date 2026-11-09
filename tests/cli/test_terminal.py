import json
import subprocess
import time
from pathlib import Path

import pytest
from typer.testing import CliRunner

from hephaistos.cli.main import app
from hephaistos.core.terminals.tmux import TmuxKeeper
from support import clone, create, git

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


def test_create(keeper: TmuxKeeper, proj: Path) -> None:
    assert ok("create", "--dir", str(proj)) == [
        f"Created terminal proj-1 in {proj}",
        f"  attach with: tmux -L {keeper.socket} attach -t =proj-1",
    ]
    lines = ok("create", "-n", "build", "-d", str(proj), "--", "sh", "-c", "exec sleep 60")
    assert lines[0] == f"Created terminal build in {proj}, running sh -c 'exec sleep 60'"


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
    for args in (("show", "x"), ("rename", "x", "y"), ("kill", "x")):
        assert failed(*args) == "no terminal named x on this machine"


def test_rename_and_kill(tmp_path: Path) -> None:
    ok("create", "-n", "api", "-d", str(tmp_path))
    assert ok("rename", "api", "web") == ["Renamed terminal api to web"]
    assert ok("kill", "web") == ["Killed terminal web"]
    assert ok("list") == ["name  status  repo  directory  program  attached  active"]


def test_kill_a_lost_one(keeper: TmuxKeeper, tmp_path: Path) -> None:
    ok("create", "-n", "api", "-d", str(tmp_path))
    subprocess.run([keeper.binary, "-L", keeper.socket, "kill-server"], check=True)
    assert ok("list")[1].split()[:2] == ["api", "lost"]
    assert ok("kill", "api") == ["Forgot lost terminal api"]


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
