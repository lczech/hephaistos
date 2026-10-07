"""Facts about git repositories, read by running git's commands meant for scripts.

Knows nothing about our records. Paths passed in must be existing directories.
"""

import os
import re
import shutil
import subprocess
from collections.abc import Collection, Mapping
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from hephaistos.core.utils.errors import HephaistosError

TIMEOUT = 30.0  # seconds for one git command; a hung network filesystem must not block us


class GitError(HephaistosError):
    """git is missing, or failed where it should have succeeded."""


class GitTimeoutError(GitError):
    """A git command took longer than its timeout."""


class NotInRepositoryError(GitError):
    """A path is not in a git repository."""


def _git(path: Path, *args: str, timeout: float = TIMEOUT) -> subprocess.CompletedProcess[str]:
    """Runs git in `path`; the caller checks the exit code."""
    executable = shutil.which("git")
    if executable is None:
        raise GitError("git is not installed")
    # Reading must never take locks that the user's own git commands would wait for.
    env = {**os.environ, "GIT_OPTIONAL_LOCKS": "0"}
    try:
        return subprocess.run(  # noqa: S603 - arguments are a list, never passed through a shell
            [executable, "-C", str(path), *args],
            capture_output=True,
            encoding="utf-8",
            errors="surrogateescape",
            env=env,
            check=False,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        raise GitTimeoutError(f"`git {args[0]}` timed out after {timeout:g} s in {path}") from None


def _output(path: Path, *args: str, timeout: float = TIMEOUT) -> str:
    """The output of git without the final newline; raises GitError if it fails."""
    result = _git(path, *args, timeout=timeout)
    if result.returncode != 0:
        raise GitError(f"`git {' '.join(args)}` failed in {path}: {result.stderr.strip()}")
    return result.stdout.removesuffix("\n")


@dataclass(frozen=True)
class Location:
    """Where a directory lies within a git repository."""

    top: Path  # resolved: the working tree's top level, or the git directory if bare
    main: Path | None  # for a linked worktree: its main working tree or bare git directory
    common_dir: Path  # resolved: the git directory shared by all worktrees


_LOCATE_LINES = 4


def locate(path: Path, timeout: float = TIMEOUT) -> Location:
    """The git repository that `path` lies in; raises GitError if none."""
    result = _git(
        path,
        "rev-parse",
        "--is-bare-repository",
        "--is-inside-work-tree",
        "--absolute-git-dir",
        "--git-common-dir",
        timeout=timeout,
    )
    if result.returncode != 0:
        raise NotInRepositoryError(f"{path} is not in a git repository")
    lines = result.stdout.removesuffix("\n").split("\n")
    if len(lines) != _LOCATE_LINES:
        raise GitError(f"unexpected output from `git rev-parse` in {path}")
    bare, inside, git_dir, common_dir = lines
    if bare == "true":
        top = Path(git_dir).resolve()
    elif inside == "true":
        top = Path(_output(path, "rev-parse", "--show-toplevel", timeout=timeout)).resolve()
    else:
        raise GitError(f"{path} is inside a git directory, not a working tree")

    common = (path / common_dir).resolve()
    main = None
    if Path(git_dir).resolve() != common:
        # The first entry of `worktree list` is the main working tree, or the bare repository.
        first = _output(path, "worktree", "list", "--porcelain", timeout=timeout).split("\n", 1)[0]
        main = Path(first.removeprefix("worktree ")).resolve()
    return Location(top=top, main=main, common_dir=common)


@dataclass(frozen=True)
class Entry:
    """A path that `git status` reports, with git's state letters for index and working tree.

    The letters: `.` unchanged, M, T, A, D, R, C; `?` for untracked; for conflicts git's own.
    """

    path: str
    index: str
    worktree: str
    conflicted: bool = False
    original: str | None = None  # the path before a rename or copy


@dataclass(frozen=True)
class Status:
    """A working tree's state relative to HEAD and to its upstream branch."""

    upstream: str | None  # e.g. `origin/main`
    ahead: int | None  # None without upstream, or if it is gone
    behind: int | None
    entries: tuple[Entry, ...]

    @property
    def staged(self) -> int:
        """Files with staged changes."""
        return sum(self._tracked(entry) and entry.index != "." for entry in self.entries)

    @property
    def changed(self) -> int:
        """Files changed in the working tree but not staged."""
        return sum(self._tracked(entry) and entry.worktree != "." for entry in self.entries)

    @property
    def untracked(self) -> int:
        """Untracked files; an untracked directory counts once."""
        return sum(entry.index == "?" for entry in self.entries)

    @property
    def conflicted(self) -> int:
        """Files with merge conflicts."""
        return sum(entry.conflicted for entry in self.entries)

    @staticmethod
    def _tracked(entry: Entry) -> bool:
        return not entry.conflicted and entry.index != "?"


def parse_status(output: str) -> Status:
    """Parses `git status --porcelain=v2 --branch -z`."""
    upstream: str | None = None
    ahead: int | None = None
    behind: int | None = None
    entries: list[Entry] = []
    fields = iter(output.split("\0"))
    for field in fields:
        if field.startswith("# branch.upstream "):
            upstream = field.removeprefix("# branch.upstream ")
        elif field.startswith("# branch.ab "):
            plus, minus = field.removeprefix("# branch.ab ").split()
            ahead, behind = int(plus), -int(minus)
        elif field.startswith("? "):
            entries.append(Entry(field[2:], "?", "?"))
        elif field.startswith("1 "):
            parts = field.split(" ", 8)
            entries.append(Entry(parts[8], parts[1][0], parts[1][1]))
        elif field.startswith("2 "):
            # A rename or copy: the original path follows as the next field.
            parts = field.split(" ", 9)
            entries.append(Entry(parts[9], parts[1][0], parts[1][1], original=next(fields)))
        elif field.startswith("u "):
            parts = field.split(" ", 10)
            entries.append(Entry(parts[10], parts[1][0], parts[1][1], conflicted=True))
    return Status(upstream=upstream, ahead=ahead, behind=behind, entries=tuple(entries))


def status(top: Path, timeout: float = TIMEOUT) -> Status:
    """The status of the working tree at `top`; ignored files are left out."""
    return parse_status(
        _output(
            top,
            "status",
            "--porcelain=v2",
            "--branch",
            "-z",
            "--untracked-files=normal",
            timeout=timeout,
        )
    )


def branches(top: Path, timeout: float = TIMEOUT) -> tuple[str, ...]:
    """The local branches' names, sorted."""
    output = _output(top, "for-each-ref", "--format=%(refname)", "refs/heads", timeout=timeout)
    return tuple(sorted(line.removeprefix("refs/heads/") for line in output.splitlines()))


_NO_COMMIT = "0" * 40


@dataclass(frozen=True)
class LinkedWorktree:
    """A linked worktree as git lists it; the main working tree is not one."""

    name: str  # its admin directory: <common dir>/worktrees/<name>; kept when moved
    path: Path
    head: str | None  # None before the first commit
    branch: str | None  # None when HEAD is detached
    lock_reason: str | None  # None unless locked; empty if locked without a reason


def _worktree_names(common_dir: Path) -> dict[Path, str]:
    """The linked worktrees' admin names, by their resolved paths."""
    admin = common_dir / "worktrees"
    names: dict[Path, str] = {}
    try:
        entries = list(admin.iterdir()) if admin.is_dir() else []
        for entry in entries:
            gitdir = entry / "gitdir"
            if gitdir.is_file():
                # It holds the path to the worktree's `.git` file, absolute or relative to `entry`.
                names[(entry / gitdir.read_text().strip()).resolve().parent] = entry.name
    except OSError as error:
        raise GitError(f"reading {admin} failed: {error}") from error
    return names


def worktrees(top: Path, common_dir: Path, timeout: float = TIMEOUT) -> tuple[LinkedWorktree, ...]:
    """The linked worktrees of the repository at `top`, including those whose directory is gone."""
    # Without -z, which needs git 2.36: paths with newlines are not supported.
    output = _output(top, "worktree", "list", "--porcelain", timeout=timeout)
    names = _worktree_names(common_dir)
    found: list[LinkedWorktree] = []
    for record in output.split("\n\n")[1:]:  # the first is the main working tree
        lines = record.splitlines()
        if not lines or not lines[0].startswith("worktree "):
            continue
        path = Path(lines[0].removeprefix("worktree "))
        attributes: dict[str, str] = {}
        for line in lines[1:]:
            key, _, value = line.partition(" ")
            attributes[key] = value
        name = names.get(path.resolve())
        if name is None:
            continue  # being created or removed right now
        head = attributes.get("HEAD")
        found.append(
            LinkedWorktree(
                name=name,
                path=path,
                head=None if head in (None, _NO_COMMIT) else head,
                branch=attributes["branch"].removeprefix("refs/heads/")
                if "branch" in attributes
                else None,
                lock_reason=attributes.get("locked"),
            )
        )
    return tuple(found)


@dataclass(frozen=True)
class ReflogEntry:
    """One entry of a reflog: `ref` moved to `new`, with git's message saying why."""

    ref: str  # in full: `HEAD`, `refs/heads/main`, `refs/remotes/origin/main`
    old: str | None  # the previous entry's `new`; None for the oldest entry read
    new: str
    at: datetime  # with the offset git recorded
    message: str


def _reflog(top: Path, *args: str, timeout: float) -> list[ReflogEntry]:
    """Reflog entries as `git log --walk-reflogs` lists them: newest first, ref by ref."""
    output = _output(
        top,
        "log",
        "--walk-reflogs",
        "--no-show-signature",
        "--date=iso-strict",
        "--format=%H%x1f%gD%x1f%gs",
        *args,
        timeout=timeout,
    )
    read: list[tuple[str, str, datetime, str]] = []
    for line in output.splitlines():
        new, selector, message = line.split("\x1f", 2)
        ref, _, date = selector.rpartition("@{")
        read.append((ref, new, datetime.fromisoformat(date.removesuffix("}")), message))
    previous: dict[str, str] = {}
    entries: list[ReflogEntry] = []
    for ref, new, at, message in reversed(read):
        entries.append(ReflogEntry(ref, previous.get(ref), new, at, message))
        previous[ref] = new
    return entries[::-1]


def reflog(
    top: Path, ref: str = "HEAD", *, limit: int | None = None, timeout: float = TIMEOUT
) -> list[ReflogEntry]:
    """The newest entries of a ref's reflog, or all; empty if it has none.

    HEAD must exist, i.e. have a commit. Each worktree has its own HEAD reflog.
    """
    return _reflog(top, *([f"--max-count={limit}"] if limit else []), ref, timeout=timeout)


def remote_reflogs(top: Path, timeout: float = TIMEOUT) -> list[ReflogEntry]:
    """The reflogs of all remote-tracking branches, newest first for each."""
    return _reflog(top, "--remotes", timeout=timeout)


def is_rebasing(git_dir: Path) -> bool:
    """Whether a rebase (or `git am`) is in progress in the working tree of `git_dir`."""
    return (git_dir / "rebase-merge").is_dir() or (git_dir / "rebase-apply").is_dir()


@dataclass(frozen=True)
class Snapshot:
    """What git says about a repository at one moment."""

    bare: bool
    head: str | None  # None before the first commit
    branch: str | None  # None when HEAD is detached
    root_commits: tuple[str, ...]  # sorted
    remotes: Mapping[str, str]  # name → URL without credentials
    branches: tuple[str, ...]  # local ones, sorted
    status: Status | None  # None if bare


def snapshot(top: Path, timeout: float = TIMEOUT) -> Snapshot:
    """The current facts about the repository at `top`."""
    bare = _output(top, "rev-parse", "--is-bare-repository", timeout=timeout) == "true"
    head_result = _git(top, "rev-parse", "--verify", "--quiet", "HEAD", timeout=timeout)
    head = head_result.stdout.strip() if head_result.returncode == 0 else None
    branch_result = _git(top, "symbolic-ref", "--quiet", "--short", "HEAD", timeout=timeout)
    branch = branch_result.stdout.strip() if branch_result.returncode == 0 else None
    return Snapshot(
        bare=bare,
        head=head,
        branch=branch,
        root_commits=root_commits(top, include_head=head is not None, timeout=timeout),
        remotes=remotes(top, timeout),
        branches=branches(top, timeout),
        status=None if bare else status(top, timeout),
    )


def root_commits(
    top: Path, *, include_head: bool = True, timeout: float = TIMEOUT
) -> tuple[str, ...]:
    """The commits without parents, reachable from HEAD and all local and remote branches."""
    refs = ["HEAD"] if include_head else []
    output = _output(
        top, "rev-list", "--max-parents=0", *refs, "--branches", "--remotes", timeout=timeout
    )
    return tuple(sorted(set(output.split()))) if output else ()


def shares_history(roots: Collection[str], known: Collection[str]) -> bool:
    """Whether root commits are compatible with `known` ones: some in common, or either empty."""
    return not roots or not known or not set(roots).isdisjoint(known)


def remotes(top: Path, timeout: float = TIMEOUT) -> dict[str, str]:
    """The remotes' names and URLs, without credentials."""
    result = _git(top, "config", "-z", "--get-regexp", r"^remote\..*\.url$", timeout=timeout)
    if result.returncode == 1:  # no remotes
        return {}
    if result.returncode != 0:
        raise GitError(f"reading the remotes failed in {top}: {result.stderr.strip()}")
    found: dict[str, str] = {}
    for entry in filter(None, result.stdout.split("\0")):
        key, _, url = entry.partition("\n")
        name = key.removeprefix("remote.").removesuffix(".url")
        found.setdefault(name, without_credentials(url))
    return found


def main_remote(remotes: Mapping[str, str]) -> str | None:
    """The URL of `origin`, else of the first remote by name; None without remotes."""
    if "origin" in remotes:
        return remotes["origin"]
    return remotes[min(remotes)] if remotes else None


def without_credentials(url: str) -> str:
    """The URL without a password, and without the user name for HTTP, where it may be a token."""
    if "://" not in url:
        return url
    parts = urlsplit(url)
    if parts.password is None and (parts.username is None or not parts.scheme.startswith("http")):
        return url
    user = "" if parts.scheme.startswith("http") else f"{parts.username}@"
    host = parts.hostname or ""
    port = f":{parts.port}" if parts.port else ""
    return urlunsplit((parts.scheme, f"{user}{host}{port}", parts.path, parts.query, ""))


_SCP_LIKE = re.compile(r"(?:[^@/]+@)?(?P<host>[^:/]+):(?P<path>.*)")


def normalise_remote(url: str) -> str:
    """The URL as `host/path`, so that SSH and HTTPS URLs of the same repository are equal."""
    if "://" in url:
        parts = urlsplit(url)
        host = "" if parts.scheme == "file" else parts.hostname or ""
        path = parts.path
    elif match := _SCP_LIKE.fullmatch(url):
        host, path = match["host"].lower(), match["path"]
    else:  # a local path
        host, path = "", url
    path = path.strip("/").removesuffix(".git").rstrip("/")
    return f"{host}/{path}" if host else f"/{path}"


def repository_name(url: str) -> str:
    """The last part of a remote's path, e.g. `hephaistos` for `git@host:a/hephaistos.git`."""
    return normalise_remote(url).rsplit("/", 1)[-1]
