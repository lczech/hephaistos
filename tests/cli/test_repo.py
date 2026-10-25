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


def test_register_list_rename() -> None:
    assert runner.invoke(app, ["repo", "register", "proj"]).output.splitlines() == [
        "Registered repository proj; register its clones with:",
        "  hephaistos clone register <path> --repo proj",
    ]
    runner.invoke(app, ["repo", "register", "other"])
    assert runner.invoke(app, ["repo", "list"]).output.splitlines() == [
        "name   clones  active  remote",
        "other  0       -       -",
        "proj   0       -       -",
    ]
    runner.invoke(app, ["repo", "rename", "proj", "project"])
    data = json.loads(runner.invoke(app, ["repo", "list", "--json"]).output)
    assert [repository["name"] for repository in data] == ["other", "project"]


def test_register_a_directory_suggests_its_clone(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = create(tmp_path / "repo")
    monkeypatch.chdir(repo)
    result = runner.invoke(app, ["repo", "register", f"{repo}/"])
    assert str(result.exception).splitlines() == [
        (
            f"{repo}/ is a directory, not a repository name; to register the git clone there,"
            " in the repository it matches or a new one:"
        ),
        f"  hephaistos clone register {repo}",
    ]
    result = runner.invoke(app, ["repo", "register", "."])
    assert str(result.exception).splitlines()[-1] == f"  hephaistos clone register {repo}"
    result = runner.invoke(app, ["repo", "register", "no/such/dir"])
    assert str(result.exception).startswith("'no/such/dir' is not a repository name")
    assert runner.invoke(app, ["repo", "list", "--json"]).output.strip() == "[]"


def test_show() -> None:
    runner.invoke(app, ["repo", "register", "proj"])
    data = json.loads(runner.invoke(app, ["repo", "show", "proj", "--json"]).output)
    assert data["name"] == "proj"
    assert data["clones"] == []


def test_show_unknown() -> None:
    result = runner.invoke(app, ["repo", "show", "proj"])
    assert isinstance(result.exception, HephaistosError)


def test_unregister_without_clones() -> None:
    runner.invoke(app, ["repo", "register", "proj"])
    result = runner.invoke(app, ["repo", "unregister", "proj"])
    assert result.output == "Unregistered repository proj (files untouched)\n"
    assert runner.invoke(app, ["repo", "list", "--json"]).output.strip() == "[]"


def test_unregister_with_clones(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = create(tmp_path / "repo")
    clone(repo, tmp_path / "copy")
    runner.invoke(app, ["scan", str(tmp_path), "--yes"])
    result = runner.invoke(app, ["repo", "unregister", "repo"])
    assert isinstance(result.exception, HephaistosError)
    assert str(result.exception).splitlines()[0] == "repo still has 2 clones:"
    assert str(result.exception).splitlines()[-1] == "unregister them first, or give --clones"

    result = runner.invoke(app, ["repo", "unregister", "repo", "--clones"])
    assert str(result.exception).startswith("not asking without a terminal")
    monkeypatch.setattr(terminal, "interactive", lambda: True)
    result = runner.invoke(app, ["repo", "unregister", "repo", "--clones"], input="\n")
    assert result.exit_code == 1
    assert "Unregister repo and its 2 clones? [y/N]" in result.output

    result = runner.invoke(app, ["repo", "unregister", "repo", "--clones"], input="y\n")
    unregistered = "Unregistered repository repo and its 2 clones (files untouched)\n"
    assert result.output.endswith(unregistered)
    assert runner.invoke(app, ["clone", "list", "--json"]).output.strip() == "[]"
    assert repo.exists()
