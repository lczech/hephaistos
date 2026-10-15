import json
import os
from pathlib import Path

import pytest
from typer.testing import CliRunner

from hephaistos import __version__
from hephaistos.cli import terminal
from hephaistos.cli.main import app, without_debug
from hephaistos.core.registry import machines
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.paths import Paths, short_path
from support import logged, run_cli

runner = CliRunner()


def test_help_rewraps_paragraphs() -> None:
    result = runner.invoke(app, ["scan", "--help"], env={"COLUMNS": "200"})
    assert "skips hidden directories. A clone that matches several Repositories" in result.output


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
    assert data["setup"]["database"] == str(paths.database)
    [mount] = data["mounts"]
    assert (mount["path"], mount["filesystem"]["name"]) == ("/", "laptop-local")


def test_errors_are_messages_not_tracebacks(
    paths: Paths, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    assert run_cli(monkeypatch, "machine", "show") == 1
    message = "hephaistos is not set up on this Machine; run `hephaistos setup`"
    assert capsys.readouterr().err == f"error: {message}\n"
    assert logged(paths)[-1]["message"] == f"end: error: {message}"


def test_runs_are_logged_with_their_events(
    paths: Paths, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    assert run_cli(monkeypatch, "setup", "--name", "laptop") == 0
    assert run_cli(monkeypatch, "machine", "show", "--nope") == 2
    assert capsys.readouterr().err.count("--nope") == 1  # nothing but the usage error
    lines = logged(paths)
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
    assert run_cli(monkeypatch, "machine", "list") == 1
    error, end = logged(paths)[-2:]
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
    assert run_cli(monkeypatch, "--version") == 0
    assert run_cli(monkeypatch, "log", "show") == 0
    assert (
        capsys.readouterr()
        .out.splitlines()[-1]
        .endswith("end: ok exit_code=0 duration=" + str(logged(paths)[-1]["duration"]))
    )
    assert [line["message"] for line in logged(paths)] == [
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
    assert run_cli(monkeypatch, "setup", "--name", "laptop", "--debug") == 0
    err = capsys.readouterr().err.splitlines()
    assert "INFO  cli[" in err[0]
    start = f"start: hephaistos setup --name laptop version={__version__} cwd={Path.cwd()}"
    assert err[0].endswith(start)
    assert any("DEBUG cli[" in line and " committed events=3 " in line for line in err)
    assert "DEBUG" in {line["level"] for line in logged(paths)}


def test_a_log_that_cannot_be_written_is_a_warning(
    paths: Paths, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    paths.state_dir.parent.mkdir(parents=True)
    paths.state_dir.write_text("a file where the directory should be")
    assert run_cli(monkeypatch, "--version") == 0
    out, err = capsys.readouterr()
    assert out == f"hephaistos {__version__}\n"
    assert err.startswith("warning: cannot write the log: ")


@pytest.mark.usefixtures("paths")
def test_machine_list() -> None:
    runner.invoke(app, ["setup", "--name", "laptop"])
    lines = runner.invoke(app, ["machine", "list"]).output.splitlines()
    assert lines[0].split() == ["name", "hostname", "chassis"]
    assert lines[1].split()[:2] == ["*", "laptop"]
    assert lines[1].split()[-1] == "laptop"  # as the tests' stub of systemd says
    [machine] = json.loads(runner.invoke(app, ["machine", "list", "--json"]).output)
    assert (machine["name"], machine["this"]) == ("laptop", True)


@pytest.mark.usefixtures("paths")
def test_machine_show_by_name_matches_list() -> None:
    runner.invoke(app, ["setup", "--name", "laptop"])
    [listed] = json.loads(runner.invoke(app, ["machine", "list", "--json"]).output)
    shown = json.loads(runner.invoke(app, ["machine", "show", "laptop", "--json"]).output)
    assert shown == listed | {"setup": shown["setup"]}
    assert "journal_mode" in shown["setup"]

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


def test_settings_are_loaded_and_used(
    paths: Paths, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    paths.config_dir.mkdir(parents=True)
    (paths.config_dir / "config.toml").write_text('[log]\nlevel = "warning"\n')
    assert run_cli(monkeypatch, "--version") == 0
    assert logged(paths) == []  # nothing at warning level or above
    monkeypatch.setenv("HEPHAISTOS_LOG_LEVEL", "debug")
    assert run_cli(monkeypatch, "setup", "--name", "laptop") == 0
    assert "DEBUG" in {line["level"] for line in logged(paths)}
    assert capsys.readouterr().err == ""


def test_a_broken_config_stops_commands_but_log(
    paths: Paths, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    paths.config_dir.mkdir(parents=True)
    broken = paths.config_dir / "config.toml"
    broken.write_text("[git]\ntimeout = 0\n")
    problem = f"{broken}: git.timeout must be more than 0, not 0.0"

    assert run_cli(monkeypatch, "machine", "list") == 1
    assert capsys.readouterr().err == f"error: {problem}\n"
    assert logged(paths)[-1]["message"] == f"end: error: {problem}"

    assert run_cli(monkeypatch, "log", "show", "-n", "1") == 0
    out, err = capsys.readouterr()
    assert out.rstrip().endswith(
        f"end: error: {problem} exit_code=1 duration=" + str(logged(paths)[-1]["duration"])
    )
    assert err == f"warning: {problem}; using the defaults\n"

    assert run_cli(monkeypatch, "--version") == 0
    assert run_cli(monkeypatch, "machine", "--help") == 0

    capsys.readouterr()
    assert run_cli(monkeypatch, "config", "show", "git.timeout") == 1
    assert capsys.readouterr() == ("30.0\n", f"error: {problem}\n")  # no warning first


def test_our_directories_are_made_private(
    paths: Paths, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    assert run_cli(monkeypatch, "setup", "--name", "laptop") == 0
    paths.state_dir.chmod(0o755)
    capsys.readouterr()
    assert run_cli(monkeypatch, "machine", "show") == 0
    shown = short_path(paths.state_dir)
    assert capsys.readouterr().err == f"warning: others could enter {shown}; now only you can\n"
    assert run_cli(monkeypatch, "machine", "show") == 0
    assert capsys.readouterr().err == ""


def test_another_users_directory_is_refused(
    paths: Paths, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    assert run_cli(monkeypatch, "setup", "--name", "laptop") == 0
    owner = os.getuid()
    monkeypatch.setattr(os, "getuid", lambda: owner + 1)
    capsys.readouterr()
    assert run_cli(monkeypatch, "machine", "show") == 1
    assert capsys.readouterr().err == (
        f"error: {paths.data_dir} belongs to another user (uid {owner}); hephaistos keeps its"
        " files only in directories of yours\n"
    )
