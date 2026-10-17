"""What changed in a working tree between two states, as git compares them; nothing is stored.

A state is `index`, `worktree`, or a commit, by anything git resolves to one (`HEAD`, `main~2`).
Without states, the changes come in the groups `git status` shows; for one file, also git's
patch and both its versions. Only git's commands meant for scripts run, never external diff
tools or text conversions, and none takes a lock.
"""

from dataclasses import dataclass, replace
from pathlib import Path, PurePosixPath
from typing import Literal

from hephaistos.core.utils import git
from hephaistos.core.utils.errors import HephaistosError

INDEX = "index"
WORKTREE = "worktree"
HEAD = "HEAD"

FOLDER_FILES = 10_000  # files of a new folder counted; beyond, it says that there are more
BINARY_PROBE = 8000  # bytes in which a NUL makes a file binary, as git decides it

type GroupName = Literal["staged", "unstaged", "untracked", "unmerged", "changes"]

_NO_OBJECT = "0" * 40  # git's object ID for "none", or "not hashed" for the working tree
_SAFE = ("--no-ext-diff", "--no-textconv")  # git's own diff of the files' bytes
_DIFF = ("diff", "--raw", "--numstat", "-z", "--no-abbrev", "-M", *_SAFE)
_RAW = ("diff", "--raw", "-z", "--no-abbrev", "-M", *_SAFE)
# A patch as any client reads it, whatever the user's git config says about colours, prefixes
# and quoting paths.
_PATCH = (
    "-c",
    "core.quotePath=false",
    "diff",
    "--no-color",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    *_SAFE,
)


class ChangesError(HephaistosError):
    """A state or path that can't be compared here."""


@dataclass(frozen=True)
class Change:
    """A changed file, or a new folder (its path ending in `/`) with the files in it.

    Lines are counted for text; sizes, in bytes, are given for files without counted lines.
    """

    path: str
    status: str  # git's letter: A, M, D, R, T; U unmerged; ? untracked
    original: str | None = None  # the path before a rename
    added: int | None = None  # None for binary files, those too large, and folders
    removed: int | None = None
    binary: bool = False
    size: int | None = None  # the new version's; None if deleted, or not needed
    old_size: int | None = None  # the old version's; None if added, or not needed
    files: int | None = None  # in a new folder, at most FOLDER_FILES
    more_files: bool = False  # a new folder with more than FOLDER_FILES


@dataclass(frozen=True)
class Group:
    """Changes from one state to another, sorted by path; at most a limit of them."""

    name: GroupName
    base: str  # the state compared from
    target: str  # and to
    changes: tuple[Change, ...]
    count: int  # all of them, also those beyond the limit


@dataclass(frozen=True)
class Changes:
    """A working tree's changes, with its branch as `git status` says, if it was asked."""

    status: git.Status | None
    groups: tuple[Group, ...]


def _pathspec(path: str | None) -> list[str]:
    """The arguments limiting git to a path in the working tree; raises ChangesError if outside."""
    if path is None:
        return []
    parts = PurePosixPath(path).parts
    if not parts or PurePosixPath(path).is_absolute() or ".." in parts:
        raise ChangesError(f"path must lie within the Checkout, not be {path!r}")
    return ["--", path]


def _resolved(top: Path, state: str) -> str:
    """`index`, `worktree`, or the commit a state names; an unborn HEAD is the empty tree."""
    if state in (INDEX, WORKTREE):
        return state
    if state:
        result = git.run(
            top, "rev-parse", "--verify", "--quiet", "--end-of-options", f"{state}^{{commit}}"
        )
        if result.returncode == 0:
            return result.stdout.strip()
        if state == HEAD and git.run(top, "symbolic-ref", "--quiet", HEAD).returncode == 0:
            return git.read(top, "hash-object", "-t", "tree", "--stdin", stdin="")
    raise ChangesError(f"{state!r} is neither index, worktree nor a commit here")


def diff_arguments(base: str, target: str) -> list[str] | None:
    """What `git diff` compares two resolved states with; None for a state with itself."""
    if base == target:
        return None
    if base == INDEX and target == WORKTREE:
        return []
    if base == WORKTREE and target == INDEX:
        return ["-R"]
    reverse = base in (INDEX, WORKTREE)  # git compares a commit only to the index or worktree
    commit, state = (target, base) if reverse else (base, target)
    cached = ["--cached"] if state == INDEX else []
    commits = [commit] if state in (INDEX, WORKTREE) else [base, target]
    return [*cached, *(["-R"] if reverse else []), *commits]


@dataclass(frozen=True)
class _Raw:
    """A file as `git diff --raw` lists it."""

    status: str
    path: str
    original: str | None
    old_object: str
    new_object: str


def _parse_diff(output: str) -> tuple[list[_Raw], dict[str, tuple[int | None, int | None]]]:
    """Parses `git diff --raw --numstat -z`: the files, and their lines added and removed."""
    fields = output.split("\0")
    raws: list[_Raw] = []
    counts: dict[str, tuple[int | None, int | None]] = {}
    index = 0
    while index < len(fields) and fields[index].startswith(":"):
        _, _, old_object, new_object, status = fields[index][1:].split(" ")
        if status[0] in "RC":
            original, path = fields[index + 1], fields[index + 2]
            index += 3
        else:
            original, path = None, fields[index + 1]
            index += 2
        raws.append(_Raw(status[0], path, original, old_object, new_object))
    while index < len(fields) and fields[index]:
        added, removed, path = fields[index].split("\t", 2)
        index += 1
        if not path:  # a rename: the original path, then the new one, follow
            path = fields[index + 1]
            index += 2
        counts[path] = (
            None if added == "-" else int(added),
            None if removed == "-" else int(removed),
        )
    return raws, counts


def _object_sizes(top: Path, objects: set[str]) -> dict[str, int]:
    """The sizes of objects in git's database, in bytes."""
    if not objects:
        return {}
    listed = git.read(
        top,
        "cat-file",
        "--batch-check=%(objectname) %(objectsize)",
        stdin="\n".join(objects) + "\n",
    )
    sizes: dict[str, int] = {}
    for line in listed.splitlines():
        name, _, size = line.partition(" ")
        if size.isdigit():
            sizes[name] = int(size)
    return sizes


def _file_size(path: Path) -> int | None:
    """A file's size in the working tree, without following a symlink; None if unreadable."""
    try:
        return path.lstat().st_size
    except OSError:
        return None


def _tracked(
    top: Path, raws: list[_Raw], counts: dict[str, tuple[int | None, int | None]]
) -> list[Change]:
    """Changes from `git diff`; binary files with their sizes."""
    binary = [raw for raw in raws if raw.status != "U" and counts.get(raw.path, (0, 0))[0] is None]
    sizes = _object_sizes(
        top,
        {name for raw in binary for name in (raw.old_object, raw.new_object) if name != _NO_OBJECT},
    )

    def size(name: str, path: str, *, exists: bool) -> int | None:
        if not exists:
            return None
        if name == _NO_OBJECT:  # the working tree's, which git didn't hash
            return _file_size(top / path)
        return sizes.get(name)

    changes: list[Change] = []
    for raw in raws:
        added, removed = counts.get(raw.path, (None, None))
        change = Change(raw.path, raw.status, raw.original, added, removed)
        if raw in binary:
            change = replace(
                change,
                binary=True,
                size=size(raw.new_object, raw.path, exists=raw.status != "D"),
                old_size=size(raw.old_object, raw.original or raw.path, exists=raw.status != "A"),
            )
        changes.append(change)
    return changes


def _counted(top: Path, path: str, max_bytes: int) -> Change:
    """An untracked file's lines, all added; or its size, if binary or larger than `max_bytes`."""
    change = Change(path, "?")
    file = top / path
    size = _file_size(file)
    if size is None or file.is_symlink() or size > max_bytes:
        return replace(change, size=size)
    try:
        data = file.read_bytes()
    except OSError:
        return replace(change, size=size)
    if b"\0" in data[:BINARY_PROBE]:
        return replace(change, binary=True, size=size)
    lines = data.count(b"\n") + (not data.endswith(b"\n") and bool(data))
    return replace(change, added=lines, removed=0)


def _folder(top: Path, path: str) -> Change:
    """A new folder with how many files are in it, as git lists them, and their size."""
    listed = git.read(
        top, "--literal-pathspecs", "ls-files", "--others", "--exclude-standard", "-z", "--", path
    )
    files = [name for name in listed.split("\0") if name]
    counted = files[:FOLDER_FILES]
    sizes = [_file_size(top / name) for name in counted]
    return Change(
        path,
        "?",
        files=len(counted),
        more_files=len(files) > FOLDER_FILES,
        size=sum(size for size in sizes if size is not None),
    )


def _untracked(top: Path, paths: list[str], max_bytes: int) -> list[Change]:
    """Untracked files with their lines counted, and new folders with their files."""
    return [
        _folder(top, path) if path.endswith("/") else _counted(top, path, max_bytes)
        for path in paths
    ]


def _group(name: GroupName, base: str, target: str, changes: list[Change], limit: int) -> Group:
    """A group of these changes, sorted, and cut to `limit`."""
    ordered = sorted(changes, key=lambda change: change.path)
    return Group(name, base, target, tuple(ordered[:limit]), len(ordered))


def _status(top: Path, pathspec: list[str]) -> git.Status:
    """`git status` of the working tree, or of a path in it, listing a new folder's files then."""
    untracked = "all" if pathspec else "normal"
    return git.parse_status(
        git.read(
            top,
            "--literal-pathspecs",
            "status",
            "--porcelain=v2",
            "--branch",
            "-z",
            f"--untracked-files={untracked}",
            *pathspec,
        )
    )


def _diff(top: Path, arguments: list[str], pathspec: list[str]) -> list[Change]:
    """The changes `git diff` finds with these arguments."""
    raws, counts = _parse_diff(git.read(top, "--literal-pathspecs", *_DIFF, *arguments, *pathspec))
    return _tracked(top, raws, counts)


def changes(  # noqa: PLR0913 - the optional ones are keyword-only
    top: Path,
    base: str | None = None,
    target: str | None = None,
    *,
    path: str | None = None,
    max_files: int,
    max_bytes: int,
) -> Changes:
    """The changes in the working tree at `top`, or below `path` in it.

    Between two states; without them, as `git status` groups them: staged (HEAD to index), not
    staged and untracked (index to worktree), and unmerged (HEAD to worktree, with git's
    conflict markers). A file staged and changed again is in two groups. Groups without changes
    are left out. Up to `max_files` per group; untracked files larger than `max_bytes` aren't
    counted.
    """
    if (base is None) != (target is None):
        raise ChangesError("give both states to compare, or neither")
    pathspec = _pathspec(path)
    if base is None or target is None:
        return _status_groups(top, pathspec, max_files, max_bytes)
    resolved = (_resolved(top, base), _resolved(top, target))
    arguments = diff_arguments(*resolved)
    found = [] if arguments is None else _diff(top, arguments, pathspec)
    status = None
    if target == WORKTREE:  # untracked files are part of it
        status = _status(top, pathspec)
        if base != WORKTREE:
            untracked = [entry.path for entry in status.entries if entry.index == "?"]
            found += _untracked(top, untracked, max_bytes)
    group = _group("changes", base, target, found, max_files)
    return Changes(status, (group,) if group.count else ())


def _status_groups(top: Path, pathspec: list[str], max_files: int, max_bytes: int) -> Changes:
    """The changes as `git status` groups them."""
    status = _status(top, pathspec)
    unmerged = {entry.path for entry in status.entries if entry.conflicted}
    staged = [
        change for change in _diff(top, ["--cached"], pathspec) if change.path not in unmerged
    ]
    unstaged = [change for change in _diff(top, [], pathspec) if change.path not in unmerged]
    untracked = _untracked(
        top, [entry.path for entry in status.entries if entry.index == "?"], max_bytes
    )
    conflicts: list[Change] = []
    if unmerged:
        counts = {}
        if status.head is not None:
            _, counts = _parse_diff(
                git.read(top, "--literal-pathspecs", *_DIFF, HEAD, "--", *sorted(unmerged))
            )
        conflicts = [Change(path, "U", None, *counts.get(path, (None, None))) for path in unmerged]
    groups = (
        _group("unmerged", HEAD, WORKTREE, conflicts, max_files),
        _group("staged", HEAD, INDEX, staged, max_files),
        _group("unstaged", INDEX, WORKTREE, unstaged, max_files),
        _group("untracked", INDEX, WORKTREE, untracked, max_files),
    )
    return Changes(status, tuple(group for group in groups if group.count))


@dataclass(frozen=True)
class Diff:
    """A file's change from one state to another, and git's patch for it."""

    change: Change | None  # None if the file doesn't differ
    patch: str | None  # None without a change, for binary files, and those too large


@dataclass(frozen=True)
class Versions:
    """A file's contents in two states; None where it doesn't exist."""

    old: str | None
    new: str | None


def _text(output: str) -> str:
    """Output of git as text that JSON can carry: bytes that aren't UTF-8 replaced."""
    return output.encode("utf-8", "surrogateescape").decode("utf-8", "replace")


def _file_path(path: str) -> list[str]:
    """The pathspec of a file; raises ChangesError for a folder."""
    if path.endswith("/"):
        raise ChangesError(f"a diff is of a file, not of the folder {path}")
    return _pathspec(path)


def _changed(top: Path, arguments: list[str], path: str) -> Change | None:
    """The file's change, if any: found among all, so that a rename is seen whole."""
    raws, _ = _parse_diff(git.read(top, *_RAW, *arguments))
    raw = next((raw for raw in raws if path in (raw.path, raw.original)), None)
    if raw is None:
        return None
    paths = ["--", *([raw.original] if raw.original else []), raw.path]
    return next(iter(_diff(top, arguments, paths)), None)


def _untracked_file(top: Path, path: str) -> bool:
    """Whether git lists a file as untracked, not ignored."""
    listed = git.read(
        top, "--literal-pathspecs", "ls-files", "--others", "--exclude-standard", "-z", "--", path
    )
    return path in listed.split("\0")


def _patch(top: Path, arguments: list[str], change: Change, max_bytes: int) -> str | None:
    """The patch git makes for a change; None if binary, uncounted, or above `max_bytes`."""
    if change.binary or change.added is None:
        return None
    if change.status == "?":
        result = git.run(top, *_PATCH, "--no-index", "--", "/dev/null", change.path)
        if result.returncode not in (0, 1):  # 1: they differ
            raise git.GitError(f"`git diff --no-index` failed in {top}: {result.stderr.strip()}")
        output = result.stdout
    else:
        paths = [*([change.original] if change.original else []), change.path]
        output = git.read(top, "--literal-pathspecs", *_PATCH, "-M", *arguments, "--", *paths)
    patch = _text(output)
    return None if len(patch.encode()) > max_bytes else patch


def diff(top: Path, base: str, target: str, path: str, *, max_bytes: int) -> Diff:
    """A file's change from `base` to `target` in the working tree at `top`, with git's patch.

    A renamed file is found by its new path or its original one. An untracked file counts as
    added to the worktree. Patches larger than `max_bytes` are left out.
    """
    _file_path(path)
    arguments = diff_arguments(_resolved(top, base), _resolved(top, target))
    if arguments is None:
        return Diff(None, None)
    change = _changed(top, arguments, path)
    if change is None and target == WORKTREE and _untracked_file(top, path):
        change = _counted(top, path, max_bytes)
    if change is None:
        return Diff(None, None)
    return Diff(change, _patch(top, arguments, change, max_bytes))


def _contents(top: Path, state: str, path: str, max_bytes: int) -> str | None:
    """A file's contents in a resolved state; None if it isn't there; raises if too large."""
    if state == WORKTREE:
        file = top / path
        if file.is_symlink():
            return str(file.readlink())  # as git shows a symlink: its target
        size = _file_size(file)
        if size is None or not file.is_file():
            return None
        if size > max_bytes:
            raise ChangesError(f"{path} is larger than {max_bytes:,} bytes")
        return file.read_bytes().decode("utf-8", "replace")
    name = f":{path}" if state == INDEX else f"{state}:{path}"
    size = git.run(top, "cat-file", "-s", name)
    if size.returncode != 0:
        return None
    if int(size.stdout) > max_bytes:
        raise ChangesError(f"{path} is larger than {max_bytes:,} bytes")
    result = git.run(top, "cat-file", "blob", name)  # all of it: `read` drops a final newline
    if result.returncode != 0:
        raise git.GitError(f"`git cat-file` failed in {top}: {result.stderr.strip()}")
    return _text(result.stdout)


def versions(top: Path, base: str, target: str, path: str, *, max_bytes: int) -> Versions:
    """A file's contents in `base` and `target`: before a rename, at its original path.

    Raises ChangesError for a version larger than `max_bytes`.
    """
    _file_path(path)
    resolved = (_resolved(top, base), _resolved(top, target))
    arguments = diff_arguments(*resolved)
    change = None if arguments is None else _changed(top, arguments, path)
    old_path = change.original if change and change.original else path
    new_path = change.path if change else path
    return Versions(
        _contents(top, resolved[0], old_path, max_bytes),
        _contents(top, resolved[1], new_path, max_bytes),
    )
