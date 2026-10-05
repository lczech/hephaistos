"""Where our files live, and what kind of filesystem a path is on."""

import os
import re
import socket
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

DATABASE_NAME = "hephaistos.db"

NETWORK_FILESYSTEMS = frozenset(
    {
        "9p", "afs", "beegfs", "ceph", "cifs", "fuse.ceph", "fuse.gcsfuse", "fuse.glusterfs",
        "fuse.sshfs", "glusterfs", "gpfs", "lustre", "nfs", "nfs4", "panfs", "smb3", "smbfs",
        "wekafs",
    }
)  # fmt: skip


def os_machine_id() -> str | None:
    """The operating system's ID of this installation, readable without root."""
    for path in (Path("/etc/machine-id"), Path("/var/lib/dbus/machine-id")):
        try:
            value = path.read_text().strip()
        except OSError:
            continue
        if value:
            return value
    return None


def machine_key() -> str:
    """Names this Machine's subdirectories, so that shared home directories need no config."""
    return os_machine_id() or socket.gethostname()


@dataclass(frozen=True)
class Paths:
    """Where this Machine keeps its config, data (the database) and logs."""

    config_file: Path
    data_dir: Path
    state_dir: Path

    @property
    def database(self) -> Path:
        """The SQLite database file."""
        return self.data_dir / DATABASE_NAME

    @classmethod
    def from_environment(cls, env: Mapping[str, str] = os.environ) -> "Paths":
        """XDG directories, or everything under HEPHAISTOS_HOME if that is set."""
        key = machine_key()
        if home := env.get("HEPHAISTOS_HOME"):
            base = Path(home)
            return cls(base / "config.toml", base / "data" / key, base / "state" / key)

        def xdg(variable: str, default: str) -> Path:
            """An XDG base directory: the variable if set and absolute, else the default."""
            value = env.get(variable, "")
            # The XDG specification says to ignore relative paths.
            return Path(value) if Path(value).is_absolute() else Path.home() / default

        return cls(
            xdg("XDG_CONFIG_HOME", ".config") / "hephaistos" / "config.toml",
            xdg("XDG_DATA_HOME", ".local/share") / "hephaistos" / key,
            xdg("XDG_STATE_HOME", ".local/state") / "hephaistos" / key,
        )


@dataclass(frozen=True)
class MountInfo:
    """A mount as the operating system reports it (not our Mount record)."""

    mount_point: Path
    fstype: str

    @property
    def is_network(self) -> bool:
        """Whether this is a network filesystem, where SQLite's WAL mode doesn't work."""
        return self.fstype in NETWORK_FILESYSTEMS


def _unescape(field: str) -> str:
    r"""Undoes mountinfo's octal escapes, e.g. `\040` for a space."""
    return re.sub(r"\\([0-7]{3})", lambda match: chr(int(match[1], 8)), field)


_MOUNT_POINT_FIELD = 4


def parse_mountinfo(text: str) -> list[MountInfo]:
    """Parses /proc/self/mountinfo (see proc(5))."""
    mounts: list[MountInfo] = []
    for line in text.splitlines():
        before, separator, after = line.partition(" - ")
        fields = before.split()
        if not separator or len(fields) <= _MOUNT_POINT_FIELD or not after:
            continue
        mounts.append(MountInfo(Path(_unescape(fields[_MOUNT_POINT_FIELD])), after.split()[0]))
    return mounts


def mount_of(path: Path, mounts: list[MountInfo] | None = None) -> MountInfo:
    """The mount that `path` (resolved, existing or not) lies on."""
    if mounts is None:
        mounts = parse_mountinfo(Path("/proc/self/mountinfo").read_text())
    resolved = Path(os.path.realpath(path))
    candidates = [mount for mount in mounts if resolved.is_relative_to(mount.mount_point)]
    if not candidates:
        raise ValueError(f"no mount found for {path}")
    # Deepest mount point wins; for the same point, the later mount hides the earlier one.
    return max(reversed(candidates), key=lambda mount: len(mount.mount_point.parts))


def absolute(path: Path, env: Mapping[str, str] = os.environ) -> Path:
    """`path` made absolute with symlinks kept, starting from the directory the shell shows."""
    if path.is_absolute():
        return Path(os.path.normpath(path))
    cwd = Path.cwd()
    pwd = env.get("PWD")
    if pwd and Path(pwd).is_absolute():
        try:
            if Path(pwd).samefile(cwd):
                cwd = Path(pwd)
        except OSError:
            pass
    return Path(os.path.normpath(cwd / path))


def displayed(typed: Path, target: Path) -> Path:
    """`target` as the user sees it, given `typed`, an absolute path at or below it.

    `target` is a resolved ancestor of what `typed` resolves to. The levels below it are removed
    from `typed`, keeping its symlinks; if that doesn't lead to `target`, `target` is returned.
    """
    resolved = typed.resolve()
    if not resolved.is_relative_to(target):
        return target
    depth = len(resolved.relative_to(target).parts)
    if depth >= len(typed.parts):
        return target
    candidate = typed.parents[depth - 1] if depth else typed
    return candidate if candidate.resolve() == target else target
