import json
import re
from pathlib import Path
from typing import Any

import pytest
from typer.testing import CliRunner

from hephaistos.cli import terminal
from hephaistos.cli.main import app
from hephaistos.core.utils.errors import HephaistosError
from support import clone, create, git

runner = CliRunner()


@pytest.fixture
def repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A set-up Machine with Repository `proj`, and a git repository as the working directory."""
    monkeypatch.setenv("HEPHAISTOS_HOME", str(tmp_path / "home"))
    runner.invoke(app, ["setup", "--name", "laptop"])
    runner.invoke(app, ["repo", "add", "proj"])
    repo = create(tmp_path / "repo", origin="git@host:me/hephaistos.git")
    monkeypatch.chdir(repo)
    monkeypatch.setenv("PWD", str(repo))
    return repo


def interactive(monkeypatch: pytest.MonkeyPatch) -> None:
    """Lets commands ask, as if run in a terminal."""
    monkeypatch.setattr(terminal, "interactive", lambda: True)


def test_no_match_suggests_scan(repo: Path) -> None:
    result = runner.invoke(app, ["clone", "add"])
    assert isinstance(result.exception, HephaistosError)
    assert str(result.exception).splitlines()[1:] == [f"  hephaistos scan {repo}"]


def test_add_with_repo_then_list_and_show(repo: Path) -> None:
    result = runner.invoke(app, ["clone", "add", "--repo", "proj"])
    assert result.exit_code == 0, result.output
    assert result.output.startswith("Added Clone")

    result = runner.invoke(app, ["clone", "list"])
    assert result.output.splitlines()[1].split() == [
        "proj",
        "main",
        "clean",
        "now",
        "laptop-local",
        str(repo),
    ]

    result = runner.invoke(app, ["repo", "list"])
    assert result.output.splitlines()[1].split() == ["proj", "1", "host/me/hephaistos"]

    result = runner.invoke(app, ["clone", "show", "--json"])
    data = json.loads(result.output)
    assert data["repository"] == "proj"
    assert data["remotes"] == {"origin": "git@host:me/hephaistos.git"}

    result = runner.invoke(app, ["repo", "show", "proj"])
    assert any(line.split()[:2] == ["clone", str(repo)] for line in result.output.splitlines())


def test_matching_clone_needs_confirmation(
    repo: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner.invoke(app, ["clone", "add", "--repo", "proj"])
    copy = clone(repo, tmp_path / "copy")

    result = runner.invoke(app, ["clone", "add", str(copy)])
    assert isinstance(result.exception, HephaistosError)
    assert "matches proj; choose one with --repo" in str(result.exception)

    interactive(monkeypatch)
    result = runner.invoke(app, ["clone", "add", str(copy)], input="n\n")
    assert result.exit_code == 1
    result = runner.invoke(app, ["clone", "add", str(copy)], input="\n")
    assert result.exit_code == 0, result.output
    assert len(json.loads(runner.invoke(app, ["clone", "list", "--json"]).output)) == 2


def test_several_matches_are_numbered(
    repo: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner.invoke(app, ["repo", "add", "fork"])
    runner.invoke(app, ["clone", "add", "--repo", "proj"])
    fork = clone(repo, tmp_path / "fork")
    git(fork, "remote", "set-url", "origin", "git@host:someone/hephaistos.git")
    runner.invoke(app, ["clone", "add", str(fork), "--repo", "fork"])
    copy = clone(repo, tmp_path / "copy")  # shares its history with both
    interactive(monkeypatch)
    result = runner.invoke(app, ["clone", "add", str(copy)], input="3\n1\n")
    assert result.exit_code == 0, result.output
    assert "  1  fork\n  2  proj\n" in result.output
    assert result.output.endswith("to fork\n")


def test_remove(repo: Path) -> None:
    runner.invoke(app, ["clone", "add", "--repo", "proj"])
    result = runner.invoke(app, ["clone", "remove"])
    assert result.exit_code == 0, result.output
    assert "files untouched" in result.output
    assert repo.exists()
    assert json.loads(runner.invoke(app, ["clone", "list", "--json"]).output) == []
    assert result.output.splitlines()[-1] == (
        "proj has no Clones left; `hephaistos repo remove proj` removes it"
    )


def test_move_from_missing_to_found(
    repo: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    git(repo, "worktree", "add", "--quiet", str(repo / ".worktrees" / "fix"))
    runner.invoke(app, ["clone", "add", "--repo", "proj"])
    runner.invoke(app, ["observe"])
    [worktree] = _json("worktree", "list")
    (tmp_path / "work").mkdir()
    moved = repo.rename(tmp_path / "work" / "repo")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("PWD", str(tmp_path))
    runner.invoke(app, ["observe"])

    result = runner.invoke(app, ["scan", str(tmp_path / "work")])
    assert f"  hephaistos clone move {repo} {moved}" in result.output.splitlines()
    result = runner.invoke(app, ["clone", "move", str(repo), str(moved)])
    assert str(result.exception).startswith("the links to Worktrees of")
    git(moved, "worktree", "repair", str(moved / ".worktrees" / "fix"))
    result = runner.invoke(app, ["clone", "move", str(repo), str(moved)])
    assert result.exit_code == 0, result.output

    kinds = [event["kind"] for event in _json("event", "list")]
    assert set(kinds[:2]) == {"clone.found", "worktree.moved"}  # observed right after the move
    assert kinds[2:4] == ["clone.moved", "clone.missing"]
    [after] = _json("worktree", "list")
    assert (after["id"], after["path"]) == (worktree["id"], str(moved / ".worktrees" / "fix"))


def test_move_with_hint_for_nested(
    repo: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner.invoke(app, ["clone", "add", "--repo", "proj"])
    runner.invoke(app, ["scan", str(create(repo / "lib")), "--yes"])
    moved = repo.rename(tmp_path / "moved")
    result = runner.invoke(app, ["clone", "move", str(repo), str(moved)])
    assert result.exit_code == 0, result.output
    assert result.output.splitlines() == [
        f"Moved Clone {repo} of proj to {moved}",
        "Clones inside it, also moved? Record them with:",
        f"  hephaistos clone move {repo / 'lib'} {moved / 'lib'}",
    ]
    monkeypatch.setenv("HOME", str(tmp_path))  # for short paths
    result = runner.invoke(app, ["event", "list", "--kind", "clone.moved"])
    assert result.output.rstrip().endswith("~/repo → ~/moved")


def _json(*args: str) -> Any:  # noqa: ANN401 - any JSON value
    return json.loads(runner.invoke(app, [*args, "--json"]).output)


def _fields(*args: str) -> list[list[str]]:
    """`show` output as [label, value] pairs; labels may contain single spaces."""
    output = runner.invoke(app, list(args)).output
    return [re.split(r"\s{2,}", line, maxsplit=1) for line in output.splitlines()]


def test_show_has_everything_and_list_entries_match_it(repo: Path) -> None:
    runner.invoke(app, ["clone", "add", "--repo", "proj"])
    fields = _fields("clone", "show")
    for field in (
        ["resolved path", str(repo)],
        ["observed by", "laptop"],
        ["present", "yes"],
        ["bare", "no"],
        ["error", "-"],
    ):
        assert field in fields

    [listed] = _json("clone", "list")
    assert listed == _json("clone", "show")
    [repository] = _json("repo", "list")
    assert repository == _json("repo", "show", "proj")
    assert repository["remotes"] == ["host/me/hephaistos"]
    assert repository["clones"] == [listed]
    assert ["remote", "host/me/hephaistos"] in _fields("repo", "show", "proj")
