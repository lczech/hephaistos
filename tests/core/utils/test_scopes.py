import os
from pathlib import Path

import pytest

from hephaistos.core.utils import scopes
from hephaistos.core.utils.scopes import Scopes


def test_environment_plain_and_escaped() -> None:
    text = r"""HOME=/home/u
EMPTY=
URLS=$'https://a.example https://b.example '
QUOTED=$'it\'s\tone\nline'
UNICODE=$'café'
no equals sign
=no name
"""
    assert scopes.parse_environment(text) == {
        "HOME": "/home/u",
        "EMPTY": "",
        "URLS": "https://a.example https://b.example ",
        "QUOTED": "it's\tone\nline",
        "UNICODE": "café",
    }


def test_command_runs_in_a_scope() -> None:
    found = Scopes("/usr/bin/systemd-run", {})
    assert found.command(["sh", "-l"], unit="u", description="d") == [
        "/usr/bin/systemd-run",
        *("--user", "--scope", "--quiet", "--collect", "--unit=u", "--description=d"),
        *("--", "sh", "-l"),
    ]
    assert "--unit=u" not in found.command(["sh"], unit=None, description="d")


def test_none_where_systemctl_fails() -> None:
    assert scopes.detect() is None  # the tests' systemctl fails, as without a user manager


def test_none_without_systemd_run(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("PATH", str(tmp_path))
    assert scopes.detect() is None


def test_the_managers_environment(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    fake = tmp_path
    (fake / "systemctl").write_text("#!/bin/sh\nprintf 'A=1\\nB=$%s\\n' \"'x y'\"\n")
    (fake / "systemd-run").write_text("#!/bin/sh\n")
    for name in ("systemctl", "systemd-run"):
        (fake / name).chmod(0o755)
    monkeypatch.setenv("PATH", f"{fake}{os.pathsep}{os.environ['PATH']}")
    found = scopes.detect()
    assert found == Scopes(str(fake / "systemd-run"), {"A": "1", "B": "x y"})
