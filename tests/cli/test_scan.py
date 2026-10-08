from pathlib import Path

import pytest
from typer.testing import CliRunner

from hephaistos.cli import terminal
from hephaistos.cli.main import app
from hephaistos.core.utils.errors import HephaistosError
from support import clone, create, git

runner = CliRunner()


@pytest.fixture
def root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A set-up Machine, and a directory with clones of two projects, one with a Worktree."""
    monkeypatch.setenv("HEPHAISTOS_HOME", str(tmp_path / "home"))
    runner.invoke(app, ["setup", "--name", "laptop"])
    root = tmp_path / "Repos"
    first = create(root / "proj", origin="git@host:me/proj.git")
    git(first, "worktree", "add", "--quiet", str(root / "proj-feature"))
    create(root / "other")
    create(root / "org" / "other")
    clone(first, root / "copy")
    return root


def _lines(*args: str, input: str | None = None) -> list[str]:  # noqa: A002 - as CliRunner names it
    result = runner.invoke(app, ["scan", *args], input=input)
    assert result.exit_code == 0, result.output
    return result.output.splitlines()


def test_plan_needs_a_terminal_or_yes(root: Path) -> None:
    result = runner.invoke(app, ["scan", str(root)])
    assert isinstance(result.exception, HephaistosError)
    assert str(result.exception).startswith("not asking without a terminal")
    lines = result.output.splitlines()
    assert [line.split()[:3] for line in lines[:5]] == [
        ["path", "action", "repository"],
        [str(root / "copy"), "new", "proj"],
        [str(root / "org" / "other"), "skip", "-"],
        [str(root / "other"), "skip", "-"],
        [str(root / "proj"), "join", "proj"],
    ]
    assert "To add the skipped ones by hand:" in lines
    assert "  hephaistos repo add <name>" in lines
    assert lines[-1] == "Not listed: 1 Worktree of a Clone above (-v lists them)"


def test_verbose_lists_everything(root: Path) -> None:
    result = runner.invoke(app, ["scan", str(root), "-v"])
    rows = [line.split()[:2] for line in result.output.splitlines()[1:7]]
    assert [str(root / "proj-feature"), "worktree"] in rows
    assert "Not listed" not in result.output


def test_add_with_yes_then_nothing_to_add(root: Path) -> None:
    lines = _lines(str(root), "--yes")
    assert lines[-1] == "Added 2 Clones (1 new Repository)"
    lines = _lines(str(root), "--yes")
    assert lines[-1] == "Nothing to add"
    result = runner.invoke(app, ["clone", "list"])
    assert len(result.output.splitlines()) == 3


def test_add_after_asking(root: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(terminal, "interactive", lambda: True)
    lines = _lines(str(root / "org"), input="\n")
    assert lines[-2:] == [
        "Add 1 Clone (1 new Repository)? [Y/n]: ",
        "Added 1 Clone (1 new Repository)",
    ]
    result = runner.invoke(app, ["scan", str(root / "proj")], input="n\n")
    assert result.exit_code == 1
    assert "Added" not in result.output


@pytest.mark.usefixtures("root")
def test_nothing_found(tmp_path: Path) -> None:
    empty = tmp_path / "empty"
    empty.mkdir()
    assert _lines(str(empty)) == [f"No git clones found under {empty} (depth 3)"]


def test_new_worktree_is_observed(root: Path) -> None:
    _lines(str(root), "--yes")
    git(root / "proj", "worktree", "add", "--quiet", str(root / "proj-fix"))
    lines = _lines(str(root), "--yes")
    assert lines[-1] == "Observed 1 new Worktree"
    result = runner.invoke(app, ["worktree", "list"])
    assert "proj-fix" in result.output
