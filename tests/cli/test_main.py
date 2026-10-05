import json

import pytest
from typer.testing import CliRunner

from hephaistos import __version__
from hephaistos.cli.main import app, run
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.paths import Paths

runner = CliRunner()


def test_version() -> None:
    result = runner.invoke(app, ["--version"])
    assert result.exit_code == 0
    assert result.output.strip() == f"hephaistos {__version__}"


@pytest.mark.usefixtures("paths")
def test_setup_then_machine_show() -> None:
    result = runner.invoke(app, ["setup", "--name", "laptop"])
    assert result.exit_code == 0, result.output
    assert "Set up Machine laptop" in result.output

    result = runner.invoke(app, ["machine", "show"])
    assert result.exit_code == 0, result.output
    lines = result.output.splitlines()
    assert lines[0].split() == ["name", "laptop"]
    assert any(line.split() == ["mount", "/", "laptop-local"] for line in lines)


def test_machine_show_json(paths: Paths) -> None:
    runner.invoke(app, ["setup", "--name", "laptop"])
    result = runner.invoke(app, ["machine", "show", "--json"])
    data = json.loads(result.output)
    assert data["name"] == "laptop"
    assert data["database"] == str(paths.database)
    assert data["mounts"] == [{"path": "/", "filesystem": "laptop-local"}]


@pytest.mark.usefixtures("paths")
def test_errors_are_messages_not_tracebacks(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr("sys.argv", ["hephaistos", "machine", "show"])
    with pytest.raises(SystemExit) as exit_info:
        run()
    assert exit_info.value.code == 1
    assert capsys.readouterr().err == (
        "error: hephaistos is not set up on this Machine; run `hephaistos setup`\n"
    )


@pytest.mark.usefixtures("paths")
def test_machine_list() -> None:
    runner.invoke(app, ["setup", "--name", "laptop"])
    lines = runner.invoke(app, ["machine", "list"]).output.splitlines()
    assert lines[0].split() == ["name", "hostname"]
    assert lines[1].split()[:2] == ["*", "laptop"]
    [machine] = json.loads(runner.invoke(app, ["machine", "list", "--json"]).output)
    assert (machine["name"], machine["this"]) == ("laptop", True)


@pytest.mark.usefixtures("paths")
def test_machine_show_by_name_matches_list() -> None:
    runner.invoke(app, ["setup", "--name", "laptop"])
    [listed] = json.loads(runner.invoke(app, ["machine", "list", "--json"]).output)
    shown = json.loads(runner.invoke(app, ["machine", "show", "laptop", "--json"]).output)
    assert shown.items() >= listed.items()
    assert "journal_mode" in shown

    result = runner.invoke(app, ["machine", "show", "desktop"])
    assert isinstance(result.exception, HephaistosError)
