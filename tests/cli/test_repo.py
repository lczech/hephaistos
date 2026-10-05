import json

import pytest
from typer.testing import CliRunner

from hephaistos.cli.main import app
from hephaistos.core.utils.errors import HephaistosError

runner = CliRunner()


@pytest.fixture(autouse=True)
def set_up(paths: object) -> None:
    del paths
    runner.invoke(app, ["setup", "--name", "laptop"])


def test_add_list_rename() -> None:
    assert runner.invoke(app, ["repo", "add", "proj"]).output == "Added Repository proj\n"
    runner.invoke(app, ["repo", "add", "other"])
    assert runner.invoke(app, ["repo", "list"]).output.splitlines() == [
        "name   clones",
        "other  0",
        "proj   0",
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
