import json
from pathlib import Path

import pytest
from typer.testing import CliRunner

from hephaistos.cli import terminal
from hephaistos.cli.main import app
from hephaistos.core.utils.errors import HephaistosError
from support import clone, create

runner = CliRunner()


@pytest.fixture(autouse=True)
def set_up(paths: object) -> None:
    del paths
    runner.invoke(app, ["setup", "--name", "laptop"])


def test_add_list_rename() -> None:
    assert runner.invoke(app, ["repo", "add", "proj"]).output == "Added Repository proj\n"
    runner.invoke(app, ["repo", "add", "other"])
    assert runner.invoke(app, ["repo", "list"]).output.splitlines() == [
        "name   clones  remote",
        "other  0       -",
        "proj   0       -",
    ]
    runner.invoke(app, ["repo", "rename", "proj", "project"])
    data = json.loads(runner.invoke(app, ["repo", "list", "--json"]).output)
    assert [repository["name"] for repository in data] == ["other", "project"]


def test_show() -> None:
    runner.invoke(app, ["repo", "add", "proj"])
    data = json.loads(runner.invoke(app, ["repo", "show", "proj", "--json"]).output)
    assert data["name"] == "proj"
    assert data["clones"] == []


def test_show_unknown() -> None:
    result = runner.invoke(app, ["repo", "show", "proj"])
    assert isinstance(result.exception, HephaistosError)


def test_remove_without_clones() -> None:
    runner.invoke(app, ["repo", "add", "proj"])
    result = runner.invoke(app, ["repo", "remove", "proj"])
    assert result.output == "Removed Repository proj (files untouched)\n"
    assert runner.invoke(app, ["repo", "list", "--json"]).output.strip() == "[]"


def test_remove_with_clones(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = create(tmp_path / "repo")
    clone(repo, tmp_path / "copy")
    runner.invoke(app, ["scan", str(tmp_path), "--yes"])
    result = runner.invoke(app, ["repo", "remove", "repo"])
    assert isinstance(result.exception, HephaistosError)
    assert str(result.exception).splitlines()[0] == "repo still has 2 Clones:"
    assert str(result.exception).splitlines()[-1] == "remove them first, or add --clones"

    result = runner.invoke(app, ["repo", "remove", "repo", "--clones"])
    assert str(result.exception).startswith("not asking without a terminal")
    monkeypatch.setattr(terminal, "interactive", lambda: True)
    result = runner.invoke(app, ["repo", "remove", "repo", "--clones"], input="\n")
    assert result.exit_code == 1
    assert "Remove repo and its 2 Clones? [y/N]" in result.output

    result = runner.invoke(app, ["repo", "remove", "repo", "--clones"], input="y\n")
    assert result.output.endswith("Removed Repository repo and its 2 Clones (files untouched)\n")
    assert runner.invoke(app, ["clone", "list", "--json"]).output.strip() == "[]"
    assert repo.exists()
