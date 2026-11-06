"""Every path below a Directory, to find files and folders by name; read now, nothing stored.

The GUI matches the paths itself, as typed, so that typing asks for nothing; the CLI matches them
here (`matching`), with Python's regular expressions. Inside a working tree, git lists them
(`git ls-files`), leaving out what it ignores; elsewhere, or with what git ignores, a walk does,
breadth first. Neither goes into `.git` folders below the Directory, nor follows symlinks.
Listing stops at a number of paths or after some seconds, saying which; only reads.
"""

import os
import re
import stat
import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from hephaistos.core.utils import git
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.files import checked

type Stop = Literal["max_paths", "time"]

_SUBMODULE = "160000"  # the mode git gives a submodule's commit in the index


@dataclass(frozen=True)
class Paths:
    """The paths below a Directory, by name; a folder's ending in `/`.

    `stopped` says why there may be more: `max_paths` listed, or `time` up; `limit`, the number
    of paths or seconds it stopped at.
    """

    path: Path
    paths: tuple[str, ...]
    stopped: Stop | None = None
    limit: float | None = None


class _Stopped(Exception):  # noqa: N818 - not an error: listing is done
    def __init__(self, reason: Stop) -> None:
        super().__init__(reason)
        self.reason: Stop = reason


class _Listing:
    """Paths found so far, their folders first; what is left to walk; when to stop."""

    def __init__(self, *, hidden: bool, ignored: bool, max_paths: int, seconds: float) -> None:
        self.hidden = hidden
        self.ignored = ignored
        self.max_paths = max_paths
        self.deadline = time.monotonic() + seconds
        self.found: dict[str, None] = {}  # in order, once each
        self.left: deque[tuple[Path, str]] = deque()  # folders to walk, with their paths

    def add(self, path: str) -> None:
        """Adds a path, `src/` for a folder; stops at one more than the limit."""
        if path not in self.found:
            if len(self.found) >= self.max_paths:
                raise _Stopped("max_paths")
            self.found[path] = None

    def in_time(self) -> None:
        """Stops once the time is up."""
        if time.monotonic() > self.deadline:
            raise _Stopped("time")

    def shown(self, relative: str) -> bool:
        """Whether a path below a folder listed is listed: not hidden, unless hidden ones are."""
        return self.hidden or not any(part.startswith(".") for part in relative.split("/"))


def _from_git(folder: Path, prefix: str, listing: _Listing) -> None:
    """The paths git lists below a working tree's `folder`.

    Not those tracked but deleted, nor untracked but ignored. Working trees in it, submodules or
    not, are walked in turn, which lists them alike. Its own `.git` by its name, as a walk would.
    """
    try:
        mode = (folder / ".git").lstat().st_mode
    except OSError:
        mode = None  # inside a working tree, not at its top
    if mode is not None and listing.shown(".git"):
        listing.add(f"{prefix}.git/" if stat.S_ISDIR(mode) else f"{prefix}.git")
    staged = git.read(folder, "ls-files", "-z", "--stage")
    listing.in_time()
    others = git.read(folder, "ls-files", "-z", "--others", "--exclude-standard")
    listing.in_time()
    deleted = set(git.read(folder, "ls-files", "-z", "--deleted").split("\0"))
    listing.in_time()
    found: list[str] = []
    for record in filter(None, staged.split("\0")):
        info, _, path = record.partition("\t")
        found.append(f"{path}/" if info.split(" ", 1)[0] == _SUBMODULE else path)
    found.extend(filter(None, others.split("\0")))  # a working tree in it as `nested/`
    for path in found:
        if path in deleted or not listing.shown(path.rstrip("/")):
            continue
        parts = path.rstrip("/").split("/")
        for depth in range(1, len(parts)):
            listing.add(f"{prefix}{'/'.join(parts[:depth])}/")
        listing.add(f"{prefix}{path}")
        if path.endswith("/"):
            listing.left.append((folder / path.rstrip("/"), f"{prefix}{path}"))


def _walk(folder: Path, prefix: str, listing: _Listing) -> None:
    """The paths in `folder`, its folders left to walk.

    Through git if it is a working tree's top, unless with what git ignores.
    """
    try:
        with os.scandir(folder) as found:
            items = sorted(found, key=lambda item: item.name)
    except OSError:
        return  # unreadable, or gone meanwhile
    if prefix and not listing.ignored and any(item.name == ".git" for item in items):
        try:
            _from_git(folder, prefix, listing)
        except git.GitError:
            pass  # not a working tree after all: walked
        else:
            return
    for item in items:
        if not listing.shown(item.name):
            continue
        try:
            folded = item.is_dir(follow_symlinks=False)
        except OSError:
            folded = False
        listing.add(f"{prefix}{item.name}/" if folded else f"{prefix}{item.name}")
        if folded and item.name != ".git":
            listing.left.append((Path(item.path), f"{prefix}{item.name}/"))


def _through_git(directory: Path) -> bool:
    """Whether git lists what is below `directory`: in a working tree, and not ignored there."""
    try:
        # 0: ignored; 1: not, in a working tree; 128: in none, or inside a `.git` folder.
        return git.run(directory, "check-ignore", "-q", ".").returncode == 1
    except git.GitError:
        return False


def paths(path: Path, *, hidden: bool, ignored: bool, max_paths: int, seconds: float) -> Paths:
    """The paths below the Directory at `path`, at most `max_paths`, found within `seconds`.

    Hidden ones too with `hidden`, those git ignores too with `ignored`. Raises FilesError if it
    cannot be listed.
    """
    directory = checked(path)
    listing = _Listing(hidden=hidden, ignored=ignored, max_paths=max_paths, seconds=seconds)
    stopped: Stop | None = None
    try:
        if not ignored and _through_git(directory):
            try:
                _from_git(directory, "", listing)
            except git.GitError:
                listing.left.append((directory, ""))
        else:
            listing.left.append((directory, ""))
        while listing.left:
            listing.in_time()
            _walk(*listing.left.popleft(), listing)
    except _Stopped as stop:
        stopped = stop.reason
    limit = {None: None, "max_paths": max_paths, "time": seconds}[stopped]
    return Paths(directory, tuple(sorted(listing.found)), stopped, limit)


class PatternError(HephaistosError):
    """What is looked for is an invalid regular expression."""


def matching(
    found: Paths, text: str, *, case: bool = False, word: bool = False, regex: bool = False
) -> list[str]:
    """The paths whose names have `text`, as typed, case ignored.

    With a `/` in it, those whose paths below the Directory do. `case` matches case, `word` whole
    words, `regex` takes it as a regular expression, Python's.
    """
    body = text if regex else re.escape(text)
    pattern = rf"(?<!\w)(?:{body})(?!\w)" if word else body
    try:
        compiled = re.compile(pattern, 0 if case else re.IGNORECASE)
    except re.error as error:
        raise PatternError(f"invalid regular expression: {error}") from None
    by_path = "/" in text
    return [
        path
        for path in found.paths
        if compiled.search(path.rstrip("/") if by_path else path.rstrip("/").rsplit("/", 1)[-1])
    ]
