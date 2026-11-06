import dataclasses
import json
from pathlib import Path

import pytest
from typer.testing import CliRunner

from hephaistos.cli.main import app
from hephaistos.core import config
from support import create

runner = CliRunner()


def _directory(tmp_path: Path) -> Path:
    directory = tmp_path / "d"
    (directory / "src").mkdir(parents=True)
    (directory / "README").write_text("hello\n")
    (directory / "to-src").symlink_to("src")
    return directory


@pytest.mark.usefixtures("paths")
def test_lists_names_marked_by_kind(tmp_path: Path) -> None:
    result = runner.invoke(app, ["files", str(_directory(tmp_path))])
    assert result.exit_code == 0, result.output
    assert result.output.split("\n") == ["name", "README", "src/", "to-src -> src", ""]


@pytest.mark.usefixtures("paths")
def test_shows_the_fields_asked_for(tmp_path: Path) -> None:
    repo = create(tmp_path / "repo")
    (repo / "new.txt").write_text("hello\n")
    result = runner.invoke(app, ["files", str(repo), "--fields", "git,size"])
    assert result.exit_code == 0, result.output
    lines = result.output.split("\n")
    assert lines[0].split() == ["name", "size", "git"]
    assert next(line for line in lines if line.startswith("new.txt")).split() == [
        "new.txt",
        "6",
        "B",
        "?",
    ]


@pytest.mark.usefixtures("paths")
def test_refuses_unknown_fields(tmp_path: Path) -> None:
    result = runner.invoke(app, ["files", str(tmp_path), "--fields", "size,colour"])
    assert result.exit_code == 2
    assert "unknown field 'colour'" in result.output


@pytest.mark.usefixtures("paths")
def test_says_what_is_not_listed(tmp_path: Path) -> None:
    config.activate(dataclasses.replace(config.DEFAULTS, files=config.Files(max_entries=1)))
    result = runner.invoke(app, ["files", str(_directory(tmp_path))])
    assert result.exit_code == 0, result.output
    assert "2 more entries not listed, as the setting files.max_entries allows 1" in result.output


@pytest.mark.usefixtures("paths")
def test_json_lists_entries_and_their_count(tmp_path: Path) -> None:
    directory = _directory(tmp_path)
    result = runner.invoke(app, ["files", str(directory), "--json"])
    assert result.exit_code == 0, result.output
    found = json.loads(result.output)
    assert (found["path"], found["top"], found["count"]) == (str(directory), None, 3)
    assert found["entries"][2] == {
        "name": "to-src",
        "kind": "symlink",
        "hidden": False,
        "target": "src",
        "to": "directory",
        "size": None,
        "modified": None,
        "status": None,
        "ignored": None,
        "changed": None,
    }
