import getpass
import os
import shutil
import sqlite3
import subprocess
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from hephaistos import __version__
from hephaistos.core.utils import git, logs
from hephaistos.core.utils.paths import Paths
from hephaistos.daemon import about, checks, report, unit
from hephaistos.daemon.status import Check
from support import create, run_cli
from support import git as run_git


def _found(env: dict[str, str] | None = None) -> dict[str, list[tuple[str, str | None]]]:
    """What the checks found, by name: each outcome and fix."""
    found: dict[str, list[tuple[str, str | None]]] = {}
    for check in checks.run(os.environ if env is None else env):
        found.setdefault(check.name, []).append((check.outcome, check.fix))
    return found


def test_without_git_or_ionice(systemd: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PATH", str(systemd.parent))  # only the fake systemctl and loginctl
    found = _found()
    assert found["git"] == [("problem", "install git")]
    assert found["ionice"] == [("note", "install util-linux")]


def test_git_too_old(monkeypatch: pytest.MonkeyPatch) -> None:
    old = git.Installation(Path("/old/git"), "git version 2.30.9")
    monkeypatch.setattr(git, "installation", lambda: old)
    monkeypatch.setattr(unit, "is_available", lambda: False)
    (check,) = [check for check in checks.run() if check.name == "git"]
    assert check == Check(
        "git", "problem", "2.30.9 is too old; need 2.31 or later", "upgrade git to 2.31 or later"
    )
    assert git.Installation(Path("/git"), "git version 2.39.3 (Apple Git-146)").numbers == (2, 39)
    assert git.Installation(Path("/git"), "git version weird").numbers is None


def test_git_and_its_version(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(unit, "is_available", lambda: False)
    (check,) = [check for check in checks.run(os.environ) if check.name == "git"]
    version = subprocess.run(["git", "--version"], capture_output=True, text=True, check=True)
    assert check == Check("git", "ok", f"{version.stdout.split()[2]}, {shutil.which('git')}")


def test_an_old_sqlite(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sqlite3, "sqlite_version_info", (3, 31, 1))
    monkeypatch.setattr(sqlite3, "sqlite_version", "3.31.1")
    monkeypatch.setenv("PATH", "/nonexistent")  # no systemctl
    (check,) = [check for check in checks.run(os.environ) if check.name == "sqlite"]
    assert check == Check(
        "sqlite",
        "problem",
        "3.31.1 is too old; need 3.37 or later",
        "use a Python built with SQLite 3.37 or later",
    )


def test_without_systemd(systemd: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    del systemd
    monkeypatch.setenv("FAKE_SYSTEMD_UNAVAILABLE", "1")
    found = _found()
    assert found["systemd"] == [("note", "run `hephaistos daemon run`, e.g. in tmux")]
    assert "unit" not in found
    assert "linger" not in found


@pytest.mark.usefixtures("repo")
def test_the_unit_as_installed(
    systemd: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    found = _found()
    assert found["systemd"] == [("ok", None)]
    assert found["unit"] == [("note", "`hephaistos daemon install`")]  # not installed
    assert "linger" not in found
    assert run_cli(monkeypatch, "daemon", "install", program=str(systemd)) == 0
    found = _found()
    assert found["unit"] == [("ok", None)]
    assert found["linger"] == [("note", "`hephaistos daemon install --linger`")]
    (tmp_path / "linger").mkdir()
    (tmp_path / "linger" / getpass.getuser()).touch()
    assert _found()["linger"] == [("ok", None)]
    assert run_cli(monkeypatch, "daemon", "stop", program=str(systemd)) == 0
    elsewhere = {**os.environ, "XDG_STATE_HOME": "/s"}
    assert _found(elsewhere)["unit"] == [("problem", "`hephaistos daemon install`")]
    by_the_daemon = [c for c in checks.run() if c.name == "unit"]  # its paths are its own
    assert [(c.outcome, c.text) for c in by_the_daemon] == [("ok", "installed and enabled")]
    assert [check.text for check in checks.unit_problems(elsewhere)] == [
        (
            "it uses other directories than this shell"
            " (XDG_STATE_HOME: not set in the unit, /s in this shell)"
        )
    ]
    assert run_cli(monkeypatch, "daemon", "uninstall", program=str(systemd)) == 0
    unit.unit_file().parent.mkdir(parents=True, exist_ok=True)
    unit.unit_file().write_text("[Service]\n")  # not ours
    (check,) = [check for check in checks.run(os.environ) if check.name == "unit"]
    assert check.outcome == "problem"
    assert check.text.endswith("was not written by hephaistos; leaving it alone")


def test_changed() -> None:
    old = [Check("git", "ok", "2.43.0, /usr/bin/git"), Check("ionice", "ok", "/usr/bin/ionice")]
    new = [Check("git", "problem", "git is not installed", "install git"), old[1]]
    assert checks.changed(old, new) == [new[0]]
    assert checks.changed(new, old) == [old[0]]
    assert checks.changed(old, old) == []


def test_log_counts(paths: Paths) -> None:
    now = datetime.now(UTC)
    paths.state_dir.mkdir(parents=True, exist_ok=True)

    def write(at: datetime, level: str) -> None:
        record = {"at": at.isoformat(), "level": level, "process": "cli", "pid": 7}
        with logs.day_file(paths.state_dir, at.date()).open("a") as file:
            file.write(logs.json_text(record | {"message": "m"}) + "\n")

    write(now - timedelta(hours=24, seconds=1), "ERROR")  # too old
    write(now - timedelta(hours=23), "ERROR")
    write(now - timedelta(hours=1), "CRITICAL")
    write(now - timedelta(hours=1), "WARNING")
    write(now, "INFO")
    counts = report.log_counts(paths, now)
    assert (counts["errors"], counts["warnings"]) == (2, 1)
    assert counts["since"] == (now - timedelta(hours=24)).isoformat()


def test_running_version(tmp_path: Path) -> None:
    assert about.running_version(tmp_path) == __version__  # not a checkout
    checkout = create(tmp_path / "checkout")
    (checkout / "src" / "hephaistos").mkdir(parents=True)
    short = run_git(checkout, "rev-parse", "--short", "HEAD")
    assert about.running_version(checkout) == f"{__version__} ({short})"
    (checkout / "README.md").write_text("new\n")
    run_git(checkout, "add", "README.md")  # staged, not committed
    assert about.running_version(checkout) == f"{__version__} ({short}-dirty)"


def test_about(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(unit, "user_environment", dict)
    env = {
        "XDG_CURRENT_DESKTOP": "GNOME",
        "XDG_SESSION_TYPE": "wayland",
        "LC_ALL": "",
        "LANG": "C.UTF-8",
        "TZ": ":Europe/Berlin",
    }
    found = about.about(env)
    assert (found["desktop"], found["locale"], found["time_zone"]) == (
        "GNOME on wayland",
        "C.UTF-8",
        "Europe/Berlin",
    )
    assert found["sqlite"] == sqlite3.sqlite_version
    assert found["version"].startswith(__version__)


def test_about_a_daemon_under_systemd(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    user = {"XDG_CURRENT_DESKTOP": "KDE", "LANG": "de_DE.UTF-8"}
    monkeypatch.setattr(unit, "user_environment", lambda: user)
    zone = tmp_path / "usr" / "share" / "zoneinfo" / "Etc" / "UTC"
    zone.parent.mkdir(parents=True)
    zone.touch()
    (tmp_path / "localtime").symlink_to(zone)
    monkeypatch.setattr(about, "LOCALTIME", tmp_path / "localtime")
    found = about.about({})
    assert (found["desktop"], found["locale"], found["time_zone"]) == (
        "KDE",
        "de_DE.UTF-8",
        "Etc/UTC",
    )
    monkeypatch.setattr(unit, "user_environment", dict)
    monkeypatch.setattr(about, "LOCALTIME", tmp_path / "none")
    found = about.about({})
    assert (found["desktop"], found["locale"], found["time_zone"]) == (None, None, None)
