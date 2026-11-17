import os
from pathlib import Path

import pytest

from hephaistos.core.utils import scopes
from hephaistos.core.utils.scopes import Scopes


def test_environment_plain_and_escaped() -> None:
    text = r"""HOME=/home/u
EMPTY=
URLS=$'https://a.example https://b.example '
QUOTED=$'a \'quote\'\tone\nline'
UNICODE=$'café'
no equals sign
=no name
"""
    assert scopes.parse_environment(text) == {
        "HOME": "/home/u",
        "EMPTY": "",
        "URLS": "https://a.example https://b.example ",
        "QUOTED": "a 'quote'\tone\nline",
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
    assert scopes.detect() is None  # systemctl fails in the tests, as without a user manager


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
    assert found == Scopes(
        str(fake / "systemd-run"), {"A": "1", "B": "x y"}, str(fake / "systemctl")
    )


#: A user manager in /m, whose scopes named `*starting*` still start; it logs what it is asked.
FAKE_SYSTEMCTL = """#!/bin/sh
shift  # --user
echo "$*" >> "$0.log"
case "$1 $2" in
"show --property=ControlGroup") echo /m ;;
"show --property=Id,ActiveState")
    shift 3
    for unit; do
        case "$unit" in *starting*) state=activating ;; *) state=active ;; esac
        printf 'Id=%s\\nActiveState=%s\\n\\n' "$unit" "$state"
    done ;;
esac
"""


def fake_manager(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, **scopes_found: int) -> Path:
    """A fake systemctl, and cgroups of scopes in app.slice, each with whether it is populated."""
    monkeypatch.setattr(scopes, "CGROUPS", tmp_path / "cgroup")
    for name, populated in scopes_found.items():
        unit = tmp_path / "cgroup" / "m" / "app.slice" / f"{name.replace('_', '-')}.scope"
        unit.mkdir(parents=True)
        (unit / "cgroup.events").write_text(f"populated {populated}\nfrozen 0\n")
    systemctl = tmp_path / "systemctl"
    systemctl.write_text(FAKE_SYSTEMCTL)
    systemctl.chmod(0o755)
    return systemctl


def test_stop_empty_stops_only_empty_active_scopes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    systemctl = fake_manager(tmp_path, monkeypatch, ours_a=0, ours_b=1, ours_starting=0, other_c=0)
    found = Scopes("systemd-run", {}, str(systemctl))
    assert found.stop_empty("ours-*.scope") == ["ours-a.scope"]
    asked = Path(f"{systemctl}.log").read_text().splitlines()
    assert asked[-1] == "stop -- ours-a.scope"


def test_stop_empty_asks_no_more_where_none_is_empty(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    systemctl = fake_manager(tmp_path, monkeypatch, ours_b=1, other_c=0)
    assert Scopes("systemd-run", {}, str(systemctl)).stop_empty("ours-*.scope") == []
    assert Path(f"{systemctl}.log").read_text().splitlines() == [
        "show --property=ControlGroup --value"
    ]


def test_stop_empty_where_systemctl_fails(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fake_manager(tmp_path, monkeypatch, ours_a=0)
    assert Scopes("systemd-run", {}, "/nonexistent/systemctl").stop_empty("ours-*.scope") == []
