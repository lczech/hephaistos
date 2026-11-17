"""Where our files live, and what kind of filesystem a path is on."""

import os
import re
import shlex
import socket
import stat
from collections.abc import Mapping, MutableMapping
from dataclasses import dataclass
from pathlib import Path

from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.text import escaped

DATABASE_NAME = "hephaistos.db"
HOME_VARIABLE = "HEPHAISTOS_HOME"  # puts all our files under one directory
# Variables that choose where our config, database and logs are.
PATH_VARIABLES = (HOME_VARIABLE, "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME")
TOKEN_NAME = "server.token"  # noqa: S105 - the file's name, not a token
DESKTOP_PROFILE_NAME = "desktop"  # the Chromium profile of the Desktop: storage, Layout, caches
DESKTOP_LOG_NAME = "desktop.log"  # the output of Electron, for when it fails
PRIVATE_MODE = 0o700  # our data and state directories: only their user may enter them
SOURCE = Path(__file__).parents[4]  # the checkout, when running from one: `src/hephaistos/…`
PACKAGE = Path(__file__).parents[2]  # the package `hephaistos`, wherever it is installed

NETWORK_FILESYSTEMS = frozenset(
    {
        "9p", "afs", "beegfs", "ceph", "cifs", "fuse.ceph", "fuse.gcsfuse", "fuse.glusterfs",
        "fuse.sshfs", "glusterfs", "gpfs", "lustre", "nfs", "nfs4", "panfs", "smb3", "smbfs",
        "wekafs",
    }
)  # fmt: skip


def own_checkout(source: Path = SOURCE) -> Path | None:
    """The git checkout hephaistos runs from, if it runs from one."""
    if (source / ".git").exists() and (source / "src" / "hephaistos").is_dir():
        return source
    return None


def code_directory() -> tuple[Path, bool]:
    """Where the code of hephaistos is: the checkout it runs from, else the installed package.

    The second value says whether it is a checkout.
    """
    checkout = own_checkout()
    return (PACKAGE, False) if checkout is None else (checkout, True)


def tree_size(directory: Path) -> int:
    """The bytes of the files below `directory`, without following symlinks; 0 if it is gone.

    What cannot be read, e.g. removed meanwhile, counts as nothing.
    """
    total, pending = 0, [directory]
    while pending:
        try:
            with os.scandir(pending.pop()) as entries:
                for entry in entries:
                    try:
                        if entry.is_dir(follow_symlinks=False):
                            pending.append(Path(entry.path))
                        elif entry.is_file(follow_symlinks=False):
                            total += entry.stat(follow_symlinks=False).st_size
                    except OSError:
                        continue
        except OSError:
            continue
    return total


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


def absolute_home(env: MutableMapping[str, str] = os.environ) -> None:
    """Makes a relative HEPHAISTOS_HOME absolute against the current directory.

    Done once at start, so that the systemd unit, the launcher entry and the processes started get
    a path that means the same directory from any other directory.
    """
    if (home := env.get(HOME_VARIABLE)) and not Path(home).is_absolute():
        env[HOME_VARIABLE] = str(current_directory() / home)


def machine_key() -> str:
    """Names this Machine's subdirectories, so that shared home directories need no config."""
    return os_machine_id() or socket.gethostname()


class ForeignDirectoryError(HephaistosError):
    """A directory where we keep our files belongs to another user."""


def private_directory(directory: Path) -> Path:
    """Creates a directory of ours, with its parents, that only the user may enter."""
    directory.mkdir(mode=PRIVATE_MODE, parents=True, exist_ok=True)
    return directory


def make_private(directory: Path) -> bool:
    """Lets only the user enter an existing directory of ours; returns whether others could.

    A symlink is followed, e.g. to data kept on a local disk. Raises ForeignDirectoryError if
    the directory belongs to another user, who could read and change what we put there.
    """
    try:
        info = directory.stat()
    except FileNotFoundError:
        return False
    if not stat.S_ISDIR(info.st_mode):  # creating it, or writing in it, will fail and tell
        return False
    if info.st_uid != os.getuid():
        raise ForeignDirectoryError(
            f"{directory} belongs to another user (uid {info.st_uid}); hephaistos keeps its"
            " files only in directories of yours"
        )
    if not info.st_mode & 0o077:
        return False
    directory.chmod(PRIVATE_MODE)
    return True


@dataclass(frozen=True)
class Paths:
    """Where this Machine keeps its config, data (the database) and logs."""

    config_dir: Path
    data_dir: Path
    state_dir: Path

    @property
    def database(self) -> Path:
        """The SQLite database file."""
        return self.data_dir / DATABASE_NAME

    @property
    def database_backup(self) -> Path:
        """Where `setup --reset` keeps the previous database."""
        return self.data_dir / f"{DATABASE_NAME}.old"

    @property
    def token(self) -> Path:
        """The Server's token, which its clients read: the Desktop, `daemon token`."""
        return self.data_dir / TOKEN_NAME

    @property
    def desktop_profile(self) -> Path:
        """The Chromium profile of the Desktop, mostly its caches."""
        return self.state_dir / DESKTOP_PROFILE_NAME

    @property
    def desktop_log(self) -> Path:
        """Where the output of Electron goes."""
        return self.state_dir / DESKTOP_LOG_NAME

    def make_private(self) -> list[Path]:
        """Lets only the user enter the data and state directories; returns those others could.

        The config directory is the user's to share, e.g. in their dotfiles; it holds no data.
        """
        return [
            directory for directory in (self.data_dir, self.state_dir) if make_private(directory)
        ]

    @classmethod
    def from_environment(cls, env: Mapping[str, str] = os.environ) -> "Paths":
        """XDG directories, or everything under HEPHAISTOS_HOME if that is set."""
        key = machine_key()
        if home := env.get(HOME_VARIABLE):
            base = Path(home)
            return cls(base, base / "data" / key, base / "state" / key)

        def xdg(variable: str, default: str) -> Path:
            """An XDG base directory: the variable if set and absolute, else the default."""
            value = env.get(variable, "")
            # The XDG specification says to ignore relative paths.
            return Path(value) if Path(value).is_absolute() else Path.home() / default

        return cls(
            xdg("XDG_CONFIG_HOME", ".config") / "hephaistos",
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
        """Whether this is a network filesystem, where SQLite's WAL mode does not work."""
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


class MissingDirectoryError(HephaistosError):
    """The current directory was deleted, e.g. a Worktree removed under a shell still in it."""


def working_directory() -> Path | None:
    """The current directory, or None if it was deleted."""
    try:
        return Path.cwd()
    except FileNotFoundError:
        return None


def current_directory() -> Path:
    """The current directory; raises MissingDirectoryError if it was deleted."""
    if (cwd := working_directory()) is None:
        raise MissingDirectoryError("the current directory no longer exists; change to another one")
    return cwd


def absolute(path: Path, env: Mapping[str, str] = os.environ) -> Path:
    """`path` made absolute with symlinks kept, starting from the directory the shell shows."""
    if path.is_absolute():
        return Path(os.path.normpath(path))
    cwd = current_directory()
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
    from `typed`, keeping its symlinks; if that does not lead to `target`, `target` is returned.
    """
    resolved = typed.resolve()
    if not resolved.is_relative_to(target):
        return target
    depth = len(resolved.relative_to(target).parts)
    if depth >= len(typed.parts):
        return target
    candidate = typed.parents[depth - 1] if depth else typed
    return candidate if candidate.resolve() == target else target


def short_path(path: Path) -> str:
    """The path with the home directory shortened to ~, its control characters escaped."""
    home = Path.home()
    if path == home:
        return "~"
    if path.is_relative_to(home):
        return escaped(f"~/{path.relative_to(home)}")
    return escaped(str(path))


def shell_path(path: Path) -> str:
    """A path as a shell argument, with the home directory as `~`; quoted only where needed."""
    home = Path.home()
    if path == home:
        return "~"
    if path.is_relative_to(home):
        return f"~/{shlex.quote(str(path.relative_to(home)))}"
    return shlex.quote(str(path))
