"""What a Directory holds, read now; nothing stored.

One Directory at a time, not what is below its directories: a tree asks for each as it opens.
Names and kinds come with the listing itself; other fields only when asked for, as they cost
more: sizes and times a `stat` each, which network filesystems make slow, and git's status a
`git status` of the Directory, in a working tree. Only reads, as everywhere in the Core.
"""

import os
import stat
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal, get_args

from hephaistos.core.utils import git
from hephaistos.core.utils.errors import HephaistosError

type Kind = Literal["file", "directory", "symlink", "other"]
type Field = Literal["size", "modified", "git"]

FIELDS: tuple[Field, ...] = get_args(Field.__value__)


class FilesError(HephaistosError):
    """A Directory that cannot be listed: not absolute, missing, not a directory, unreadable."""

    def __init__(
        self, message: str, reason: Literal["invalid", "missing", "denied", "unreadable"]
    ) -> None:
        """An error with `message`, for `reason`."""
        super().__init__(message)
        self.reason = reason


@dataclass(frozen=True)
class Entry:
    """A file, directory, symlink or other thing in a Directory.

    `size` and `modified` come with the field `size` or `modified`; `status`, `ignored` and
    `changed` with `git`, inside a working tree. A symlink's are of the link itself; `to` says
    what it points to, if anything.
    """

    name: str
    kind: Kind
    hidden: bool  # its name starts with `.`
    target: str | None = None  # a symlink's, as it reads
    to: Literal["file", "directory", "other"] | None = None  # a symlink's, followed; None if broken
    size: int | None = None  # in bytes, a file's
    modified: datetime | None = None
    status: str | None = None  # git's letter, as in changes: M, T, A, R, U, ? untracked
    ignored: bool | None = None
    changed: bool | None = None  # a directory with changes below it


@dataclass(frozen=True)
class Listing:
    """A Directory's entries, by name; at most a limit of them, and how many there are.

    `top` is the working tree it lies in, if `git` was asked for and it lies in one.
    """

    path: Path
    entries: tuple[Entry, ...]
    count: int
    top: Path | None = None


def _kind(mode: int) -> Kind:
    if stat.S_ISLNK(mode):
        return "symlink"
    if stat.S_ISDIR(mode):
        return "directory"
    return "file" if stat.S_ISREG(mode) else "other"


def _target(path: Path) -> str | None:
    """What a symlink reads; None if it is gone meanwhile, or cannot be read."""
    try:
        return str(path.readlink())
    except OSError:
        return None


def _points_to(path: Path) -> Literal["file", "directory", "other"] | None:
    """What a symlink points to, following it; None if it points nowhere."""
    try:
        mode = path.stat().st_mode
    except OSError:
        return None
    if stat.S_ISDIR(mode):
        return "directory"
    return "file" if stat.S_ISREG(mode) else "other"


def _checked(path: Path) -> Path:
    """`path`, if it is an absolute path of a directory this user may list."""
    if not path.is_absolute():
        raise FilesError(f"not an absolute path: {path}", "invalid")
    if not path.exists():
        raise FilesError(f"nothing is at {path}", "missing")
    if not path.is_dir():
        raise FilesError(f"not a directory: {path}", "invalid")
    if not os.access(path, os.R_OK | os.X_OK):
        raise FilesError(f"not allowed to list {path}", "denied")
    return path


@dataclass(frozen=True)
class _Git:
    """What git says about a Directory's entries, by name."""

    top: Path
    status: dict[str, str]
    ignored: frozenset[str]
    changed: frozenset[str]


def _git(path: Path) -> _Git | None:
    """What git says of what is in `path` and below; None outside a working tree."""
    try:
        location = git.locate(path)
    except git.GitError:
        return None
    if location.bare:
        return None
    try:
        prefix = path.resolve().relative_to(location.top).as_posix()
    except ValueError:
        return None
    prefix = "" if prefix == "." else f"{prefix}/"
    try:
        output = git.read(
            path,
            "status",
            "--porcelain=v2",
            "-z",
            "--untracked-files=normal",
            "--ignored=matching",
            "--",
            ".",
        )
    except git.GitError:  # e.g. too slow: the working tree still known, without git's letters
        return _Git(location.top, {}, frozenset(), frozenset())
    found = git.parse_status(output)
    status: dict[str, str] = {}
    changed: set[str] = set()
    for entry in found.entries:
        name, _, below = entry.path.removeprefix(prefix).rstrip("/").partition("/")
        if below:
            changed.add(name)
            continue
        if entry.conflicted:
            status[name] = "U"
        else:
            status[name] = entry.worktree if entry.worktree != "." else entry.index
    ignored = {
        path.removeprefix(prefix).rstrip("/")
        for path in found.ignored
        if "/" not in path.removeprefix(prefix).rstrip("/")
    }
    return _Git(location.top, status, frozenset(ignored), frozenset(changed))


def listing(path: Path, fields: frozenset[Field] = frozenset(), *, max_entries: int) -> Listing:
    """What the Directory at `path` holds: its first `max_entries` entries by name, and fields.

    Raises FilesError if it cannot be listed.
    """
    directory = _checked(path)
    try:
        with os.scandir(directory) as found:
            names = sorted(found, key=lambda item: item.name)
    except PermissionError:
        raise FilesError(f"not allowed to list {path}", "denied") from None
    except FileNotFoundError:
        raise FilesError(f"nothing is at {path}", "missing") from None  # gone meanwhile
    except OSError as error:
        raise FilesError(f"could not list {path}: {error.strerror}", "unreadable") from None
    statuses = _git(directory) if "git" in fields else None
    entries = tuple(_entry(item, fields, statuses) for item in names[:max_entries])
    return Listing(directory, entries, len(names), statuses.top if statuses else None)


def _entry(item: os.DirEntry[str], fields: frozenset[Field], statuses: _Git | None) -> Entry:
    """An entry, with the fields asked for."""
    try:
        own = item.stat(follow_symlinks=False) if fields & {"size", "modified"} else None
        kind = _kind(own.st_mode) if own else _kind_of(item)
    except OSError:
        own, kind = None, "other"
    symlink = kind == "symlink"
    known = statuses is not None
    return Entry(
        name=item.name,
        kind=kind,
        hidden=item.name.startswith("."),
        target=_target(Path(item.path)) if symlink else None,
        to=_points_to(Path(item.path)) if symlink else None,
        size=own.st_size if own and "size" in fields and kind == "file" else None,
        modified=(
            datetime.fromtimestamp(own.st_mtime, UTC) if own and "modified" in fields else None
        ),
        status=statuses.status.get(item.name) if statuses else None,
        ignored=item.name in statuses.ignored if statuses else None,
        changed=(item.name in statuses.changed) if known and kind == "directory" else None,
    )


def _kind_of(item: os.DirEntry[str]) -> Kind:
    """An entry's kind as the listing says it, without a `stat` where the filesystem tells."""
    if item.is_symlink():
        return "symlink"
    if item.is_dir(follow_symlinks=False):
        return "directory"
    return "file" if item.is_file(follow_symlinks=False) else "other"
