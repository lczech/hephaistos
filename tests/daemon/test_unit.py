import os
import signal
import subprocess
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from hephaistos.core.utils.paths import Paths
from hephaistos.daemon import status, unit
from hephaistos.daemon.main import running_version
from support import run_cli

UNIT = "~/.config/systemd/user/hephaistos.service"


def _calls() -> list[str]:
    """The fake systemctl and loginctl calls, without the queries."""
    calls = (Path(os.environ["FAKE_SYSTEMD"]) / "calls").read_text().splitlines()
    return [call for call in calls if " show" not in call]


def _pid(paths: Paths) -> int:
    found = status.read(paths.state_dir)
    assert found is not None
    return found.pid


def test_unit_text_round_trip() -> None:
    env = {"HEPHAISTOS_HOME": "/data/100% mine", "XDG_DATA_HOME": "", "OTHER": "x"}
    text = unit.unit_text(Path('/opt/my "tools"/hephaistos'), env)
    assert 'ExecStart="/opt/my \\"tools\\"/hephaistos" daemon run' in text.splitlines()
    assert 'Environment="HEPHAISTOS_HOME=/data/100%% mine"' in text.splitlines()
    assert unit.installed_executable(text) == Path('/opt/my "tools"/hephaistos')
    assert unit.installed_variables(text) == {"HEPHAISTOS_HOME": "/data/100% mine"}
    assert unit.path_differences(text, env) == []
    assert unit.path_differences(text, {"XDG_DATA_HOME": "/d"}) == [
        "HEPHAISTOS_HOME: the Daemon has /data/100% mine, this shell none",
        "XDG_DATA_HOME: the Daemon has none, this shell /d",
    ]


@pytest.mark.usefixtures("repo")
def test_install_start_stop_uninstall(
    paths: Paths, systemd: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    def run(*args: str) -> object:
        return run_cli(monkeypatch, "daemon", *args, program=str(systemd))

    assert run("install") == 0
    out, err = capsys.readouterr()
    first = _pid(paths)
    assert out.splitlines() == [
        f"Installed {UNIT}",
        f"The Daemon runs (pid {first})",
        (
            "Linger is off: the Daemon starts at login and stops at logout;"
            " `hephaistos daemon install --linger` keeps it running."
        ),
    ]
    assert err == (
        "warning: the Daemon won't see HEPHAISTOS_WATCHER_INTERVAL; put it in config.toml\n"
    )
    text = unit.unit_file().read_text()
    assert f'ExecStart="{systemd}" daemon run' in text
    assert f'Environment="HEPHAISTOS_HOME={os.environ["HEPHAISTOS_HOME"]}"' in text

    assert run("status") == 0
    out, err = capsys.readouterr()
    assert out.splitlines()[:2] == [
        "Unit       installed, enabled, active; linger off",
        f"Daemon     running, pid {first}, started now, version {running_version()}",
    ]
    assert err == ""

    assert run("install") == 0
    assert capsys.readouterr().out.splitlines()[:2] == [
        f"Already installed: {UNIT}",
        f"The Daemon runs (pid {first})",
    ]

    monkeypatch.setenv("XDG_DATA_HOME", "/elsewhere")
    assert run("install") == 0
    second = _pid(paths)
    assert second != first
    assert capsys.readouterr().out.splitlines()[:3] == [
        f"Updated {UNIT}:",
        '  + Environment="XDG_DATA_HOME=/elsewhere"',
        f"The Daemon restarted (pid {second})",
    ]

    assert run("stop") == 0
    assert capsys.readouterr().out == f"Stopped the Daemon (pid {second})\n"
    assert run("status") == 3
    assert "Daemon  not running; stopped now" in capsys.readouterr().out
    assert run("stop") == 0
    assert capsys.readouterr().out == "The Daemon isn't running\n"

    assert run("start") == 0
    third = _pid(paths)
    assert capsys.readouterr().out == f"The Daemon runs (pid {third})\n"
    assert run("restart") == 0
    assert capsys.readouterr().out == f"The Daemon runs again (pid {_pid(paths)})\n"

    assert run("uninstall") == 0
    assert capsys.readouterr().out == f"Stopped the Daemon and deleted {UNIT}\n"
    assert not unit.unit_file().exists()
    assert not status.is_running(paths.state_dir)
    assert run("uninstall") == 0
    assert capsys.readouterr().out == "Not installed\n"
    assert run("start") == 1
    assert "the Daemon isn't installed" in capsys.readouterr().err
    assert _calls()[:3] == [
        "systemctl --user daemon-reload",
        "systemctl --user enable --now hephaistos.service",
        "systemctl --user enable --now hephaistos.service",
    ]


@pytest.mark.usefixtures("repo")
def test_linger(
    systemd: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    assert run_cli(monkeypatch, "daemon", "install", "--linger", program=str(systemd)) == 0
    assert capsys.readouterr().out.splitlines()[-1] == (
        "Linger is on: the Daemon starts at boot and keeps running after logout."
    )
    assert "loginctl enable-linger" in _calls()
    assert run_cli(monkeypatch, "daemon", "uninstall", program=str(systemd)) == 0
    assert capsys.readouterr().out.splitlines()[-1] == (
        "Linger stays on, for all your user services; `loginctl disable-linger` ends it."
    )


@pytest.mark.usefixtures("repo")
def test_a_foreign_unit_is_left_alone(
    systemd: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    unit.unit_file().parent.mkdir(parents=True)
    unit.unit_file().write_text("[Service]\nExecStart=/bin/true\n")
    assert run_cli(monkeypatch, "daemon", "install", program=str(systemd)) == 1
    assert "wasn't written by hephaistos; leaving it alone" in capsys.readouterr().err
    assert unit.unit_file().read_text() == "[Service]\nExecStart=/bin/true\n"


@pytest.mark.usefixtures("repo")
def test_without_systemd(
    systemd: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("FAKE_SYSTEMD_UNAVAILABLE", "1")
    for command in ("install", "uninstall", "start", "restart"):
        assert run_cli(monkeypatch, "daemon", command, program=str(systemd)) == 1
        assert capsys.readouterr().err == f"error: {unit.NOT_AVAILABLE}\n"
    assert run_cli(monkeypatch, "daemon", "status", program=str(systemd)) == 3
    assert capsys.readouterr().out.splitlines() == [
        "Unit    systemd not available",
        "Daemon  not running; never ran",
    ]


def test_a_daemon_run_by_hand(
    paths: Paths,
    repo: Path,
    systemd: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    del repo
    assert run_cli(monkeypatch, "daemon", "install", program=str(systemd)) == 0
    assert run_cli(monkeypatch, "daemon", "stop", program=str(systemd)) == 0
    command = [str(systemd), "daemon", "run"]
    with subprocess.Popen(command, stderr=subprocess.PIPE) as by_hand:
        try:
            assert by_hand.stderr is not None
            by_hand.stderr.readline()  # "Running: …", once it holds the lock
            capsys.readouterr()
            assert run_cli(monkeypatch, "daemon", "start", program=str(systemd)) == 1
            assert capsys.readouterr().err == (
                f"error: a Daemon is already running (pid {by_hand.pid}), not under systemd;"
                " stop it first with `hephaistos daemon stop`\n"
            )
            assert run_cli(monkeypatch, "daemon", "status", program=str(systemd)) == 0
            assert (
                f"Daemon     running (not under systemd), pid {by_hand.pid}"
                in capsys.readouterr().out
            )
            assert run_cli(monkeypatch, "daemon", "stop", program=str(systemd)) == 0
            assert capsys.readouterr().out == f"Stopped the Daemon (pid {by_hand.pid})\n"
            assert by_hand.wait(timeout=10) == 0
        finally:
            if by_hand.poll() is None:
                by_hand.send_signal(signal.SIGKILL)
                by_hand.wait()
    assert not status.is_running(paths.state_dir)


@pytest.mark.usefixtures("repo")
def test_status_warns_about_its_unit(
    systemd: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    assert run_cli(monkeypatch, "daemon", "install", program=str(systemd)) == 0
    assert run_cli(monkeypatch, "daemon", "stop", program=str(systemd)) == 0
    text = unit.unit_file().read_text().replace(str(systemd), "/gone/hephaistos")
    unit.unit_file().write_text(text)
    monkeypatch.setenv("XDG_STATE_HOME", "/s")
    capsys.readouterr()
    assert run_cli(monkeypatch, "daemon", "status", program=str(systemd)) == 3
    assert capsys.readouterr().err.splitlines() == [
        "warning: the unit runs /gone/hephaistos, which no longer exists",
        "warning: XDG_STATE_HOME: the Daemon has none, this shell /s",
    ]


def test_status_shows_a_daemon_that_ended_without_stopping(
    paths: Paths, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("FAKE_SYSTEMD", "/nonexistent")
    monkeypatch.setenv("PATH", "/nonexistent")  # no systemctl at all
    paths.state_dir.mkdir(parents=True)
    status.write(paths.state_dir, status.Status(41233, "0.1.0", datetime.now(UTC)))
    assert run_cli(monkeypatch, "daemon", "status") == 3
    assert capsys.readouterr().out.splitlines() == [
        "Unit    systemd not available",
        "Daemon  not running; ended without stopping, last seen now",
    ]


@pytest.mark.parametrize(
    ("ago", "error", "trigger", "lines"),
    [
        (
            5,
            None,
            "watcher",
            ["Last pass  now (0.4 s), by the Watcher", "Watcher    every 60 s; next pass in 55 s"],
        ),
        (
            5,
            "the worker died",
            "api",
            [
                "Last pass  now (0.4 s), by API request; failed: the worker died",
                "Watcher    every 60 s; next pass in 55 s",
            ],
        ),
        (
            600,
            None,
            "api",
            [
                "Last pass  10m ago (0.4 s), by API request",
                "Watcher    every 60 s; stalled: last pass 10m ago",
            ],
        ),
    ],
)
def test_status_of_the_watcher(  # noqa: PLR0913 - fixtures, then the case
    paths: Paths,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    *,
    ago: int,
    error: str | None,
    trigger: status.Trigger,
    lines: list[str],
) -> None:
    monkeypatch.setenv("PATH", "/nonexistent")  # no systemctl at all
    now = datetime.now(UTC)
    done = status.PassStatus(now - timedelta(seconds=ago), 0.4, error, trigger)
    paths.state_dir.mkdir(parents=True)
    found = status.Status(os.getpid(), "0.1.0", now, parts=("watcher",), watcher=done)
    status.write(paths.state_dir, found)
    with status.held_lock(paths.state_dir):
        assert run_cli(monkeypatch, "daemon", "status") == 0
    assert capsys.readouterr().out.splitlines()[2:] == lines
