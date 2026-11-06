import dataclasses
import json
from pathlib import Path

import pytest
from typer.testing import CliRunner

from hephaistos.cli.main import app
from hephaistos.core import config
from hephaistos.core.utils.file_search import PatternError
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
    result = runner.invoke(app, ["files", "list", str(_directory(tmp_path))])
    assert result.exit_code == 0, result.output
    assert result.output.split("\n") == ["name", "README", "src/", "to-src -> src", ""]


@pytest.mark.usefixtures("paths")
def test_shows_the_fields_asked_for(tmp_path: Path) -> None:
    repo = create(tmp_path / "repo")
    (repo / "new.txt").write_text("hello\n")
    result = runner.invoke(app, ["files", "list", str(repo), "--fields", "git,size"])
    assert result.exit_code == 0, result.output
    lines = result.output.split("\n")
    assert lines[0].split() == ["name", "size", "git"]
    assert next(line for line in lines if line.startswith("new.txt")).split() == [
        "new.txt",
        "6",
        "B",
        "??",
    ]
    (repo / "docs").mkdir()
    (repo / "docs" / "a.md").write_text("")
    folders = runner.invoke(app, ["files", "list", str(repo), "--fields", "size"]).output.split(
        "\n"
    )
    assert next(line for line in folders if line.startswith("docs/")).split() == [
        "docs/",
        "1",
        "item",
    ]


@pytest.mark.usefixtures("paths")
def test_refuses_unknown_fields(tmp_path: Path) -> None:
    result = runner.invoke(app, ["files", "list", str(tmp_path), "--fields", "size,colour"])
    assert result.exit_code == 2
    assert "unknown field 'colour'" in result.output


@pytest.mark.usefixtures("paths")
def test_says_what_is_not_listed(tmp_path: Path) -> None:
    config.activate(
        dataclasses.replace(
            config.DEFAULTS, files=dataclasses.replace(config.DEFAULTS.files, max_entries=1)
        )
    )
    result = runner.invoke(app, ["files", "list", str(_directory(tmp_path))])
    assert result.exit_code == 0, result.output
    assert "2 more entries not listed, as the setting files.max_entries allows 1" in result.output


@pytest.mark.usefixtures("paths")
def test_json_lists_entries_and_their_count(tmp_path: Path) -> None:
    directory = _directory(tmp_path)
    result = runner.invoke(app, ["files", "list", str(directory), "--json"])
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
        "items": None,
        "modified": None,
        "status": None,
        "index": None,
        "worktree": None,
        "ignored": None,
        "changed": None,
    }


@pytest.mark.usefixtures("paths")
def test_searches_names_below(tmp_path: Path) -> None:
    directory = _directory(tmp_path)
    (directory / "src" / "readme.md").write_text("")
    result = runner.invoke(app, ["files", "search", "readme", str(directory)])
    assert result.exit_code == 0, result.output
    assert result.output.split("\n") == ["README", "src/readme.md", ""]
    exact = runner.invoke(app, ["files", "search", "readme", str(directory), "--case"])
    assert exact.output.split("\n") == ["src/readme.md", ""]


@pytest.mark.usefixtures("paths")
def test_finds_hidden_ones_too_unless_asked_not_to(tmp_path: Path) -> None:
    directory = _directory(tmp_path)
    (directory / ".readme").write_text("")
    found = runner.invoke(app, ["files", "search", "readme", str(directory)])
    assert found.output.split("\n") == [".readme", "README", ""]  # as `files list` shows them
    left_out = runner.invoke(app, ["files", "paths", str(directory), "--no-hidden"])
    assert ".readme" not in left_out.output.split("\n")


@pytest.mark.usefixtures("paths")
def test_searches_with_a_regular_expression(tmp_path: Path) -> None:
    result = runner.invoke(
        app, ["files", "search", r"^src$", str(_directory(tmp_path)), "--regex", "--json"]
    )
    assert result.exit_code == 0, result.output
    assert json.loads(result.output)["paths"] == ["src/"]
    invalid = runner.invoke(app, ["files", "search", "(", str(tmp_path), "--regex"])
    assert isinstance(invalid.exception, PatternError)
    assert "invalid regular expression" in str(invalid.exception)


@pytest.mark.usefixtures("paths")
def test_lists_paths_saying_where_it_stopped(tmp_path: Path) -> None:
    files = dataclasses.replace(config.DEFAULTS.files, max_paths=2)
    config.activate(dataclasses.replace(config.DEFAULTS, files=files))
    result = runner.invoke(app, ["files", "paths", str(_directory(tmp_path))])
    assert result.exit_code == 0, result.output
    assert result.output.split("\n") == [
        "README",
        "src/",
        "",
        "Stopped at 2 paths, as the setting files.max_paths allows; search a directory further in.",
        "",
    ]
