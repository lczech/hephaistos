import json
import re
from pathlib import Path

import pytest
from typer.testing import CliRunner

from hephaistos.cli import terminal
from hephaistos.cli.main import app
from hephaistos.core.utils.errors import HephaistosError
from support import clone, create, git

runner = CliRunner()


@pytest.fixture
def repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A Clone `repo` of Repository `proj` with Worktree `feature` inside it, observed."""
    monkeypatch.setenv("HEPHAISTOS_HOME", str(tmp_path / "home"))
    runner.invoke(app, ["setup", "--name", "laptop"])
    runner.invoke(app, ["repo", "add", "proj"])
    repo = create(tmp_path / "repo")
    runner.invoke(app, ["clone", "add", str(repo), "--repo", "proj"])
    git(repo, "worktree", "add", "--quiet", "-b", "feature", str(repo / ".worktrees" / "feature"))
    runner.invoke(app, ["observe"])
    return repo


def _fields(*args: str) -> list[list[str]]:
    output = runner.invoke(app, list(args)).output
    return [re.split(r"\s{2,}", line, maxsplit=1) for line in output.splitlines()]


def test_list_and_show(repo: Path) -> None:
    lines = runner.invoke(app, ["worktree", "list"]).output.splitlines()
    assert lines[1].split() == ["proj", str(repo), "feature", "clean", "now", ".worktrees/feature"]

    for target in (str(repo / ".worktrees" / "feature"), "feature"):
        fields = _fields("worktree", "show", target)
        assert ["name", "feature"] in fields
        assert ["locked", "no"] in fields
        assert ["status", "clean"] in fields

    [listed] = json.loads(runner.invoke(app, ["worktree", "list", "--json"]).output)
    shown = json.loads(runner.invoke(app, ["worktree", "show", "feature", "--json"]).output)
    assert listed == shown
    [in_clone] = json.loads(runner.invoke(app, ["clone", "show", str(repo), "--json"]).output)[
        "worktrees"
    ]
    assert shown.items() >= in_clone.items()
    assert ["worktree", ".worktrees/feature  feature  clean"] in _fields("clone", "show", str(repo))
    assert ["worktree", ".worktrees/feature  feature  clean"] in _fields("repo", "show", "proj")


def test_show_from_inside_a_clone_is_refused(repo: Path) -> None:
    result = runner.invoke(app, ["worktree", "show", str(repo)])
    assert isinstance(result.exception, HephaistosError)
    assert "not in a Worktree" in str(result.exception)


def test_names_in_several_clones(
    repo: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    other = clone(repo, tmp_path / "other")
    runner.invoke(app, ["clone", "add", str(other), "--repo", "proj"])
    git(other, "worktree", "add", "--quiet", "-b", "feature2", str(tmp_path / "feature"))
    runner.invoke(app, ["observe"])

    result = runner.invoke(app, ["worktree", "show", "feature"])
    assert isinstance(result.exception, HephaistosError)
    assert "several Worktrees are named feature" in str(result.exception)

    monkeypatch.setattr(terminal, "interactive", lambda: True)
    result = runner.invoke(app, ["worktree", "show", "feature"], input="1\n")
    assert result.exit_code == 0, result.output
    assert f"  1  {tmp_path / 'feature'}\n  2  {repo / '.worktrees' / 'feature'}\n" in result.output
    assert "branch       feature2" in result.output


def _branch(output: str) -> str:
    fields = dict(re.split(r"\s{2,}", line, maxsplit=1) for line in output.splitlines())
    return fields["branch"]


def test_new_worktrees_are_observed_first(repo: Path, tmp_path: Path) -> None:
    git(repo, "worktree", "add", "--quiet", "-b", "outside", str(tmp_path / "outside"))
    git(repo, "worktree", "add", "--quiet", "-b", "inside", str(repo / ".worktrees" / "inside"))
    git(repo, "worktree", "add", "--quiet", "-b", "third", str(tmp_path / "third"))
    result = runner.invoke(app, ["worktree", "show", str(repo / ".worktrees" / "inside")])
    assert result.exit_code == 0, result.output
    # Three branches created, three Worktrees added.
    assert result.stderr == "Observed first, as git knows more than the record (6 Events)\n"
    assert _branch(result.stdout) == "inside"
    result = runner.invoke(app, ["worktree", "show", str(tmp_path / "outside")])
    assert (result.stderr, _branch(result.stdout)) == ("", "outside")
    git(repo, "worktree", "add", "--quiet", "-b", "later", str(tmp_path / "later"))
    result = runner.invoke(app, ["worktree", "show", "later"])
    assert result.exit_code == 0, result.output
    assert result.stderr == "Observed first, as no Worktree named later was known (2 Events)\n"
    assert _branch(result.stdout) == "later"
    assert runner.invoke(app, ["worktree", "show", "later"]).stderr == ""

    result = runner.invoke(app, ["worktree", "show", "nowhere"])
    assert "no Worktree at or named nowhere" in str(result.exception)


def test_moved_worktree_is_observed_first(repo: Path, tmp_path: Path) -> None:
    git(repo, "worktree", "move", str(repo / ".worktrees" / "feature"), str(tmp_path / "moved"))
    result = runner.invoke(app, ["clone", "show", str(tmp_path / "moved")])
    assert result.exit_code == 0, result.output
    assert "(1 Event)" in result.stderr
    assert ["worktree", f"{tmp_path / 'moved'}  feature  clean"] in [
        re.split(r"\s{2,}", line, maxsplit=1) for line in result.stdout.splitlines()
    ]


def test_clone_remove_refuses_an_unobserved_worktree(repo: Path) -> None:
    inside = repo / ".worktrees" / "new"
    git(repo, "worktree", "add", "--quiet", "-b", "new", str(inside))
    result = runner.invoke(app, ["clone", "remove", str(inside)])
    assert "is in a Worktree" in str(result.exception)
    assert runner.invoke(app, ["clone", "remove", str(repo)]).exit_code == 0


@pytest.mark.usefixtures("repo")
def test_observe_counts_worktrees() -> None:
    assert runner.invoke(app, ["observe"]).output == (
        "No changes (1 Clone and 1 Worktree observed)\n"
    )


def _event_rows(*args: str) -> list[list[str]]:
    result = runner.invoke(app, ["event", "list", "-n", "0", *args])
    assert result.exit_code == 0, result.output
    return [re.split(r"\s{2,}", line) for line in result.output.splitlines()[1:]]


def test_events_by_repository_clone_and_worktree(repo: Path, tmp_path: Path) -> None:
    feature = repo / ".worktrees" / "feature"
    git(feature, "commit", "--quiet", "--allow-empty", "--message", "On feature")
    git(repo, "commit", "--quiet", "--allow-empty", "--message", "On main")
    runner.invoke(app, ["repo", "add", "other"])
    runner.invoke(app, ["clone", "add", str(create(tmp_path / "other")), "--repo", "other"])
    runner.invoke(app, ["observe"])

    by_worktree = _event_rows("--worktree", "feature")
    assert [row[4] for row in by_worktree] == ["worktree.committed", "worktree.added"]
    assert by_worktree[0][6].endswith(" On feature")
    by_clone = {row[4] for row in _event_rows("--clone", str(feature))}
    assert by_clone == {
        "worktree.committed",
        "clone.committed",
        "worktree.added",
        "clone.branch_created",
        "clone.added",
    }
    assert {row[4] for row in _event_rows("--repo", "proj")} == by_clone | {"repository.added"}
    assert [row[4] for row in _event_rows("--repo", "other")] == [
        "clone.added",
        "repository.added",
    ]
    refused = runner.invoke(app, ["event", "list", "--worktree", str(repo)])
    assert "not in a Worktree" in str(refused.exception)

    shown = runner.invoke(app, ["event", "show", by_worktree[0][0]]).output
    assert re.search(r"occurred\s+\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\n", shown)


def test_clone_add_can_import_history(repo: Path, tmp_path: Path) -> None:
    del repo
    runner.invoke(app, ["repo", "add", "other"])
    other = create(tmp_path / "other", commits=2)
    result = runner.invoke(app, ["clone", "add", str(other), "--repo", "other", "--import-history"])
    assert result.output.endswith("; imported 2 Events of its history\n")
