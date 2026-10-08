import json
from pathlib import Path

import pytest
from typer.testing import CliRunner

from hephaistos import __version__
from hephaistos.cli import terminal
from hephaistos.cli.main import app, run, without_debug
from hephaistos.core.registry import machines
from hephaistos.core.utils import logs
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


def _run(monkeypatch: pytest.MonkeyPatch, *args: str) -> object:
    """Runs the command as the entry point does; returns its exit code."""
    monkeypatch.setattr("sys.argv", ["hephaistos", *args])
    with pytest.raises(SystemExit) as exit_info:
        run()
    return exit_info.value.code


def _logged(paths: Paths) -> list[dict[str, object]]:
    return [
        json.loads(line)
        for _, path in logs.day_files(paths.state_dir)
        for line in path.read_text().splitlines()
    ]


def test_errors_are_messages_not_tracebacks(
    paths: Paths, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    assert _run(monkeypatch, "machine", "show") == 1
    message = "hephaistos is not set up on this Machine; run `hephaistos setup`"
    assert capsys.readouterr().err == f"error: {message}\n"
    assert _logged(paths)[-1]["message"] == f"end: error: {message}"


def test_runs_are_logged_with_their_events(
    paths: Paths, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    assert _run(monkeypatch, "setup", "--name", "laptop") == 0
    assert _run(monkeypatch, "machine", "show", "--nope") == 2
    assert capsys.readouterr().err.count("--nope") == 1  # nothing but the usage error
    lines = _logged(paths)
    assert [line["message"] for line in lines] == [
        "start: hephaistos setup --name laptop",
        "recorded machine.added",
        "recorded filesystem.added",
        "recorded mount.added",
        "end: ok",
        "start: hephaistos machine show --nope",
        "end: usage",
    ]
    assert {line["level"] for line in lines} == {"INFO"}
    assert {line["process"] for line in lines} == {"cli"}
    assert lines[0]["version"] == __version__
    assert {"event", "subject"} <= set(lines[1])
    assert [lines[4]["exit_code"], lines[6]["exit_code"]] == [0, 2]


def test_unexpected_errors_are_logged_with_their_traceback(
    paths: Paths, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    runner.invoke(app, ["setup", "--name", "laptop"])

    def broken(*_: object) -> None:
        raise KeyError("branch")

    monkeypatch.setattr(machines, "listing", broken)
    assert _run(monkeypatch, "machine", "list") == 1
    error, end = _logged(paths)[-2:]
    assert error["level"] == "ERROR"
    assert error["message"] == "unexpected KeyError"
    assert str(error["error"]).endswith("KeyError: 'branch'")
    assert end["message"] == "end: unexpected"

    err = capsys.readouterr().err.splitlines()
    assert err == [
        "error: unexpected KeyError: 'branch'",
        f"details: hephaistos log show --pid {error['pid']}",
    ]
    details = runner.invoke(app, err[1].split()[2:]).output.splitlines()
    assert details[0].endswith(
        "start: hephaistos machine list version=" + __version__ + f" cwd={Path.cwd()}"
    )
    assert details[-2] == "    KeyError: 'branch'"
    assert details[-1].endswith("end: unexpected exit_code=1 duration=" + str(end["duration"]))


def test_log_commands_dont_log_their_runs(
    paths: Paths, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    assert _run(monkeypatch, "--version") == 0
    assert _run(monkeypatch, "log", "show") == 0
    assert (
        capsys.readouterr()
        .out.splitlines()[-1]
        .endswith("end: ok exit_code=0 duration=" + str(_logged(paths)[-1]["duration"]))
    )
    assert [line["message"] for line in _logged(paths)] == [
        "start: hephaistos --version",
        "end: ok",
    ]


@pytest.mark.parametrize(
    ("args", "kept", "debug"),
    [
        (["--debug", "observe"], ["observe"], True),
        (["observe", "--debug"], ["observe"], True),
        (["observe"], ["observe"], False),
        (["scan", "--", "--debug"], ["scan", "--", "--debug"], False),
    ],
)
def test_without_debug(args: list[str], kept: list[str], *, debug: bool) -> None:
    assert without_debug(args) == (kept, debug)


def test_debug_shows_the_log_on_stderr(
    paths: Paths, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    assert _run(monkeypatch, "setup", "--name", "laptop", "--debug") == 0
    err = capsys.readouterr().err.splitlines()
    assert "INFO  cli[" in err[0]
    start = f"start: hephaistos setup --name laptop version={__version__} cwd={Path.cwd()}"
    assert err[0].endswith(start)
    assert any("DEBUG cli[" in line and " committed events=3 " in line for line in err)
    assert "DEBUG" in {line["level"] for line in _logged(paths)}


def test_a_log_that_cannot_be_written_is_a_warning(
    paths: Paths, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    paths.state_dir.parent.mkdir(parents=True)
    paths.state_dir.write_text("a file where the directory should be")
    assert _run(monkeypatch, "--version") == 0
    out, err = capsys.readouterr()
    assert out == f"hephaistos {__version__}\n"
    assert err.startswith("warning: cannot write the log: ")


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
