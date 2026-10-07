import dataclasses
import json
import re
import uuid
from pathlib import Path

import pytest
from typer.testing import CliRunner

from hephaistos.cli.clone import status_text
from hephaistos.cli.main import app
from hephaistos.core.state.checkouts import CheckoutState
from hephaistos.core.utils.ids import Timestamp
from support import clone, create, git

runner = CliRunner()


@pytest.fixture
def repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A set-up Machine with Clone `repo` of Repository `proj`, as the working directory."""
    monkeypatch.setenv("HEPHAISTOS_HOME", str(tmp_path / "home"))
    runner.invoke(app, ["setup", "--name", "laptop"])
    runner.invoke(app, ["repo", "add", "proj"])
    repo = clone(create(tmp_path / "origin"), tmp_path / "repo")
    monkeypatch.chdir(repo)
    monkeypatch.setenv("PWD", str(repo))
    runner.invoke(app, ["clone", "add", "--repo", "proj"])
    return repo


@pytest.mark.usefixtures("repo")
def test_no_changes() -> None:
    result = runner.invoke(app, ["observe"])
    assert result.exit_code == 0, result.output
    assert result.output == "No changes (1 Clone observed)\n"
    assert runner.invoke(app, ["observe", "clones", "--json"]).output.strip() == "[]"


def test_events_are_listed(repo: Path) -> None:
    git(repo, "branch", "feature")
    result = runner.invoke(app, ["observe", "--clone", "."])
    assert result.exit_code == 0, result.output
    lines = result.output.splitlines()
    assert lines[0].split() == [
        "id",
        "recorded",
        "machine",
        "priority",
        "kind",
        "subject",
        "summary",
    ]
    start = git(repo, "rev-parse", "--short=7", "HEAD")
    assert lines[1].split()[1:] == [
        "now",
        "laptop",
        "normal",
        "clone.branch_created",
        str(repo),
        "feature",
        "from",
        start,
    ]
    [event] = json.loads(runner.invoke(app, ["event", "list", "-n", "1", "--json"]).output)
    assert event["payload"]["branch"] == "feature"


def test_refresh(repo: Path) -> None:
    (repo / "new").write_text("x")
    listed = runner.invoke(app, ["clone", "list"]).output.splitlines()[1]
    assert listed.split()[2] == "clean"
    listed = runner.invoke(app, ["clone", "list", "--refresh"]).output.splitlines()[1]
    assert listed.split()[2] == "?1"

    git(repo, "branch", "feature")
    shown = runner.invoke(app, ["clone", "show", "--refresh"]).output
    fields = [re.split(r"\s{2,}", line, maxsplit=1) for line in shown.splitlines()]
    for field in (["status", "?1"], ["upstream", "origin/main"], ["branches", "feature, main"]):
        assert field in fields
    assert json.loads(runner.invoke(app, ["clone", "show", "--json"]).output)["untracked"] == 1


BASE = CheckoutState(
    observed_at=Timestamp(0),
    observed_by=uuid.UUID(int=0),
    present=True,
    error=None,
    head=None,
    branch="main",
    upstream="origin/main",
    ahead=0,
    behind=0,
    staged=0,
    changed=0,
    untracked=0,
    conflicted=0,
    head_log=None,
)


@pytest.mark.parametrize(
    ("changes", "expected"),
    [
        ({}, "clean"),
        ({"staged": 2, "changed": 3, "untracked": 1, "conflicted": 1}, "+2 ~3 ?1 !1"),
        ({"ahead": 1, "behind": 2}, "↑1 ↓2"),
        ({"upstream": None, "ahead": None, "behind": None}, "clean"),
        ({"staged": None, "changed": None, "untracked": None, "conflicted": None}, "bare"),
        ({"present": False, "staged": 2}, "missing"),
        ({"error": "broken"}, "failed"),
    ],
)
def test_status_text(changes: dict[str, object], expected: str) -> None:
    assert status_text(dataclasses.replace(BASE, **changes)) == expected
