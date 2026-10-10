import socket
from pathlib import Path

import pytest
from typer.testing import CliRunner

from hephaistos.cli.main import app
from hephaistos.cli.output import short_path
from hephaistos.core import config
from hephaistos.core.utils.paths import Paths

runner = CliRunner()

HOST = "login1.hpc.example.org"


@pytest.fixture
def directory(paths: Paths, monkeypatch: pytest.MonkeyPatch) -> Path:
    """The config directory, on a host with a long name."""
    monkeypatch.setattr(socket, "gethostname", lambda: HOST)
    paths.config_dir.mkdir(parents=True)
    return paths.config_dir


def test_show(directory: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    (directory / "config.toml").write_text('time_format = "short"\n[git]\ntimeout = 60\n')
    (directory / f"config.{HOST}.toml").write_text("[scan]\ndepth = 5\n")
    (directory / "config.login2.toml").write_text("")
    monkeypatch.setenv("HEPHAISTOS_OBSERVE_WORKERS", "4")
    monkeypatch.setenv("HEPHAISTOS_GIT_TIMOUT", "3")

    result = runner.invoke(app, ["config", "show"])
    assert result.exit_code == 0, result.output
    assert result.stdout.splitlines()[:10] == [
        "time_format         short  config.toml",
        "log.level           info   default",
        "log.retention_days  30     default",
        "git.timeout         60.0   config.toml",
        "observe.workers     4      HEPHAISTOS_OBSERVE_WORKERS",
        f"scan.depth          5      config.{HOST}.toml",
        "watcher.enabled     true   default",
        "watcher.interval    60.0   default",
        "",
        f"Host: {HOST}",
    ]
    width = len(short_path(directory / f"config.{HOST}.toml"))
    assert result.stdout.splitlines()[10:] == [
        f"{short_path(directory / name):<{width}}  {state}".rstrip()
        for name, state in [
            ("config.toml", "read"),
            ("config.login1.toml", "not found"),
            (f"config.{HOST}.toml", "read"),
        ]
    ] + [
        f"{'HEPHAISTOS_OBSERVE_WORKERS':<{width}}  read",
        f"{short_path(directory / 'config.login2.toml'):<{width}}  other host (unused here)",
        f"{'HEPHAISTOS_GIT_TIMOUT':<{width}}  unknown (did you mean HEPHAISTOS_GIT_TIMEOUT?)",
    ]
    assert result.stderr == ""


@pytest.mark.usefixtures("directory")
def test_show_a_section_or_one_setting() -> None:
    lines = runner.invoke(app, ["config", "show", "git"]).stdout.splitlines()
    assert lines[:3] == ["git.timeout  30.0  default", "", f"Host: {HOST}"]
    assert runner.invoke(app, ["config", "show", "git.timeout"]).stdout == "30.0\n"
    assert runner.invoke(app, ["config", "show", "time_format"]).stdout == "auto\n"


@pytest.mark.usefixtures("directory")
def test_show_an_unknown_setting() -> None:
    result = runner.invoke(app, ["config", "show", "git.timout"])
    assert result.exit_code == 2
    assert "unknown setting git.timout" in result.output
    assert "git.timeout?)" in result.output  # after "did you mean", wrapped


def test_show_leaves_out_what_is_broken(directory: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    (directory / "config.toml").write_text("[git]\ntimeout = 60\n")
    broken = directory / "config.login1.toml"
    broken.write_text('[git]\ntimeout = "1m"\n[scan]\ndepth = 5\n')
    monkeypatch.setenv("HEPHAISTOS_SCAN_DEPTH", "deep")

    result = runner.invoke(app, ["config", "show"])
    assert result.exit_code == 1
    lines = result.stdout.splitlines()
    assert "git.timeout         60.0  config.toml" in lines
    assert "scan.depth          3     default" in lines
    assert any(line.split() == [short_path(broken), "broken"] for line in lines)
    assert any(line.split() == ["HEPHAISTOS_SCAN_DEPTH", "broken"] for line in lines)
    assert result.stderr.splitlines() == [
        f'error: {broken}: git.timeout must be a number, not "1m"',
        'error: HEPHAISTOS_SCAN_DEPTH: must be an integer, not "deep"',
    ]

    one = runner.invoke(app, ["config", "show", "git.timeout"])
    assert (one.exit_code, one.stdout) == (1, "60.0\n")


def test_defaults() -> None:
    result = runner.invoke(app, ["config", "defaults"])
    assert result.exit_code == 0
    assert result.stdout == config.DEFAULTS_TEXT
    assert 'time_format = "auto"' in result.stdout
