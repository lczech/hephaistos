import json

import pytest
from typer.testing import CliRunner

from hephaistos import __version__
from hephaistos.cli import terminal
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


def _this_id() -> str:
    return json.loads(runner.invoke(app, ["machine", "show", "--json"]).output)["id"]


def test_setup_reset_asks_first(paths: Paths, monkeypatch: pytest.MonkeyPatch) -> None:
    runner.invoke(app, ["setup", "--name", "laptop"])
    old_id = _this_id()

    result = runner.invoke(app, ["setup", "--reset"])
    assert isinstance(result.exception, HephaistosError)
    assert "confirm with --yes" in str(result.exception)

    monkeypatch.setattr(terminal, "interactive", lambda: True)
    result = runner.invoke(app, ["setup", "--reset"], input="\n")
    assert result.exit_code == 1
    assert f"Machine laptop ({old_id}) is replaced" in result.output
    assert _this_id() == old_id
    assert not paths.database_backup.exists()

    result = runner.invoke(app, ["setup", "--reset"], input="y\n")
    assert result.exit_code == 0, result.output
    assert "Set up Machine laptop" in result.output
    assert result.output.endswith(f"The old database is kept as {paths.database_backup}\n")
    assert _this_id() != old_id


@pytest.mark.usefixtures("paths")
def test_setup_reset_with_yes() -> None:
    runner.invoke(app, ["setup", "--name", "laptop"])
    old_id = _this_id()
    result = runner.invoke(app, ["setup", "--reset", "--yes"])
    assert result.exit_code == 0, result.output
    assert _this_id() != old_id


@pytest.mark.usefixtures("paths")
def test_setup_reset_with_nothing_to_reset() -> None:
    result = runner.invoke(app, ["setup", "--reset", "--name", "laptop"])
    assert result.exit_code == 0, result.output
    assert result.output.startswith("Nothing to reset\nSet up Machine laptop")
