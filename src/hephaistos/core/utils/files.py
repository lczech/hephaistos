"""What a Directory holds, read now; nothing stored.

One Directory at a time, not what is below its directories: a tree asks for each as it opens.
Names and kinds come with the listing itself; other fields only when asked for, as they cost
more: sizes and times a `stat` each, which network filesystems make slow; a folder's size, its
number of entries, a listing of it; and git's status a `git status` of the Directory, in a
working tree. Only reads, as everywhere in the Core.
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

    `size` and `modified` come with the field `size` or `modified`; git's letters, `ignored` and
    `changed` with `git`, inside a working tree. A symlink's are of the link itself; `to` says
    what it points to, if anything.
    """

    name: str
    kind: Kind
    hidden: bool  # its name starts with `.`
    target: str | None = None  # a symlink's, as it reads
    to: Literal["file", "directory", "other"] | None = None  # a symlink's, followed; None if broken
    size: int | None = None  # in bytes, a file's
    items: int | None = None  # a folder's entries, with `size`; None if it cannot be listed
    modified: datetime | None = None
    status: str | None = (
        None  # git's letter shown: U unmerged, else the working tree's, else the index's
    )
    index: str | None = None  # git's letter for what is staged: M, T, A, R, D; ? untracked
    worktree: str | None = None  # and for what is not: M, T, D; ? untracked
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


def _holds(kind: Kind, item: os.DirEntry[str]) -> bool:
    """Whether an entry holds others: a folder, or a symlink to one."""
    return kind == "directory" or (kind == "symlink" and Path(item.path).is_dir())


def _items(path: str) -> int | None:
    """How many entries a folder holds, as its size; None if it cannot be listed."""
    try:
        with os.scandir(path) as found:
            return sum(1 for _ in found)
    except OSError:
        return None


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
    """What git says about a Directory's entries, by name.

    In a folder git reports as a whole, untracked or ignored, so is every entry: `every` holds
    the folder's letters, `all_ignored` whether it is ignored.
    """

    top: Path
    letters: dict[str, git.Entry]  # an entry's, as `git status` gives them
    ignored: frozenset[str]
    changed: frozenset[str]
    every: git.Entry | None = None
    all_ignored: bool = False

    def entry(self, name: str) -> git.Entry | None:
        """The letters of the entry `name`, if git has any."""
        return self.letters.get(name) or self.every

    def is_ignored(self, name: str) -> bool:
        """Whether git ignores the entry `name`."""
        return self.all_ignored or name in self.ignored


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
    letters: dict[str, git.Entry] = {}
    changed: set[str] = set()
    every: git.Entry | None = None
    # Git reports a folder that is untracked or ignored as a whole, `new/`, also when it is above
    # the Directory: then all in the Directory is.
    within = [folder for folder in found.ignored if _holds_prefix(folder, prefix)]
    for entry in found.entries:
        if _holds_prefix(entry.path, prefix):
            every = entry
            continue
        name, _, below = entry.path.removeprefix(prefix).rstrip("/").partition("/")
        if below:
            changed.add(name)
        elif name not in letters or letters[name].index == "?":
            # Git may report a path twice, staged deleted and untracked (`git rm --cached`):
            # the staged letters win.
            letters[name] = entry
    ignored = {
        path.removeprefix(prefix).rstrip("/")
        for path in found.ignored
        if "/" not in path.removeprefix(prefix).rstrip("/")
    }
    return _Git(location.top, letters, frozenset(ignored), frozenset(changed), every, bool(within))


def _holds_prefix(folder: str, prefix: str) -> bool:
    """Whether a folder git reports, `new/`, is the Directory at `prefix` or holds it."""
    return folder.endswith("/") and prefix.startswith(folder)


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
    status, index, worktree = _letters(statuses.entry(item.name) if statuses else None)
    return Entry(
        name=item.name,
        kind=kind,
        hidden=item.name.startswith("."),
        target=_target(Path(item.path)) if symlink else None,
        to=_points_to(Path(item.path)) if symlink else None,
        size=own.st_size if own and "size" in fields and kind == "file" else None,
        items=_items(item.path) if "size" in fields and _holds(kind, item) else None,
        modified=(
            datetime.fromtimestamp(own.st_mtime, UTC) if own and "modified" in fields else None
        ),
        status=status,
        index=index,
        worktree=worktree,
        ignored=statuses.is_ignored(item.name) if statuses else None,
        changed=(item.name in statuses.changed) if known and kind == "directory" else None,
    )


def _kind_of(item: os.DirEntry[str]) -> Kind:
    """An entry's kind as the listing says it, without a `stat` where the filesystem tells."""
    if item.is_symlink():
        return "symlink"
    if item.is_dir(follow_symlinks=False):
        return "directory"
    return "file" if item.is_file(follow_symlinks=False) else "other"


def _letters(entry: git.Entry | None) -> tuple[str | None, str | None, str | None]:
    """An entry's git letters: the one shown, as VS Code chooses it, then git's two, if any."""
    if entry is None:
        return None, None, None
    index = None if entry.index == "." else entry.index
    worktree = None if entry.worktree == "." else entry.worktree
    return ("U" if entry.conflicted else worktree or index), index, worktree
