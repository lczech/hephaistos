from pathlib import Path

import pytest

from hephaistos.core.utils.paths import (
    MountInfo,
    Paths,
    absolute,
    displayed,
    machine_key,
    mount_of,
    parse_mountinfo,
    shell_path,
)

MOUNTINFO = r"""
28 33 0:25 / /sys rw,nosuid shared:7 - sysfs sysfs rw
33 1 259:2 / / rw,relatime shared:1 - ext4 /dev/nvme0n1p2 rw
40 33 0:50 / /home rw,relatime shared:20 - nfs4 server:/home rw,vers=4.2
41 40 0:51 / /home/user/my\040data rw shared:21 - lustre 10.0.0.1@tcp:/scratch rw
42 33 259:3 / /mnt rw - ext4 /dev/sda1 rw
43 33 0:60 / /mnt rw - tmpfs tmpfs rw
"""


def test_hephaistos_home_holds_everything(tmp_path: Path) -> None:
    paths = Paths.from_environment({"HEPHAISTOS_HOME": str(tmp_path)})
    key = machine_key()
    assert paths.config_file == tmp_path / "config.toml"
    assert paths.data_dir == tmp_path / "data" / key
    assert paths.state_dir == tmp_path / "state" / key
    assert paths.database == tmp_path / "data" / key / "hephaistos.db"


def test_xdg_defaults(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    paths = Paths.from_environment({})
    key = machine_key()
    assert paths.config_file == tmp_path / ".config/hephaistos/config.toml"
    assert paths.data_dir == tmp_path / ".local/share/hephaistos" / key
    assert paths.state_dir == tmp_path / ".local/state/hephaistos" / key


def test_xdg_variables_and_relative_ones_ignored(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    paths = Paths.from_environment({"XDG_DATA_HOME": "/local/data", "XDG_STATE_HOME": "relative"})
    assert paths.data_dir == Path("/local/data/hephaistos", machine_key())
    assert paths.state_dir == tmp_path / ".local/state/hephaistos" / machine_key()


def test_parse_mountinfo() -> None:
    mounts = parse_mountinfo(MOUNTINFO)
    assert mounts[3] == MountInfo(Path("/home/user/my data"), "lustre")
    assert [mount.is_network for mount in mounts] == [False, False, True, True, False, False]


def test_mount_of_takes_deepest_mount() -> None:
    mounts = parse_mountinfo(MOUNTINFO)
    assert mount_of(Path("/usr/bin"), mounts).fstype == "ext4"
    assert mount_of(Path("/home/user/x"), mounts).fstype == "nfs4"
    assert mount_of(Path("/home/user/my data/y"), mounts).fstype == "lustre"
    assert mount_of(Path("/homework"), mounts).fstype == "ext4"


def test_mount_of_takes_later_mount_on_same_point() -> None:
    assert mount_of(Path("/mnt/x"), parse_mountinfo(MOUNTINFO)).fstype == "tmpfs"


def test_mount_of_this_machine() -> None:
    assert mount_of(Path("/")).mount_point == Path("/")


def test_absolute_keeps_symlinks_from_pwd(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    (tmp_path / "real").mkdir()
    (tmp_path / "link").symlink_to(tmp_path / "real")
    monkeypatch.chdir(tmp_path / "link")
    assert absolute(Path("a/../b"), {"PWD": str(tmp_path / "link")}) == tmp_path / "link" / "b"
    assert absolute(Path(), {"PWD": str(tmp_path / "link")}) == tmp_path / "link"


def test_absolute_ignores_stale_pwd(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    assert absolute(Path("x"), {"PWD": "/elsewhere"}) == tmp_path.resolve() / "x"
    assert absolute(Path("/a/./b")) == Path("/a/b")


def test_displayed_keeps_symlinks(tmp_path: Path) -> None:
    (tmp_path / "real" / "sub").mkdir(parents=True)
    (tmp_path / "link").symlink_to(tmp_path / "real")
    target = (tmp_path / "real").resolve()
    assert displayed(tmp_path / "link" / "sub", target) == tmp_path / "link"
    assert displayed(tmp_path / "link", target) == tmp_path / "link"


def test_displayed_falls_back_to_target(tmp_path: Path) -> None:
    # A symlink below the target: its levels can't be removed from the typed path.
    (tmp_path / "real" / "deep" / "er").mkdir(parents=True)
    (tmp_path / "real" / "short").symlink_to(tmp_path / "real" / "deep" / "er")
    target = (tmp_path / "real").resolve()
    assert displayed(tmp_path / "real" / "short", target) == target


def test_shell_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", "/home/me")
    assert shell_path(Path("/home/me")) == "~"
    assert shell_path(Path("/home/me/Repos/x")) == "~/Repos/x"
    assert shell_path(Path("/home/me/my repo")) == "~/'my repo'"
    assert shell_path(Path("/srv/it's")) == """'/srv/it'"'"'s'"""
    assert shell_path(Path("/home/meet")) == "/home/meet"
