"""Facts about git repositories, read by running git's commands meant for scripts.

Knows nothing about our records. Paths passed in must be existing directories.
"""

import os
import re
import shutil
import subprocess
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from hephaistos.core.utils.errors import HephaistosError


class GitError(HephaistosError):
    """git is missing, or failed where it should have succeeded."""


def _git(path: Path, *args: str) -> subprocess.CompletedProcess[str]:
    """Runs git in `path`; the caller checks the exit code."""
    executable = shutil.which("git")
    if executable is None:
        raise GitError("git is not installed")
    # Reading must never take locks that the user's own git commands would wait for.
    env = {**os.environ, "GIT_OPTIONAL_LOCKS": "0"}
    return subprocess.run(  # noqa: S603 - arguments are a list, never passed through a shell
        [executable, "-C", str(path), *args],
        capture_output=True,
        encoding="utf-8",
        errors="surrogateescape",
        env=env,
        check=False,
    )


def _output(path: Path, *args: str) -> str:
    """The output of git without the final newline; raises GitError if it fails."""
    result = _git(path, *args)
    if result.returncode != 0:
        raise GitError(f"`git {' '.join(args)}` failed in {path}: {result.stderr.strip()}")
    return result.stdout.removesuffix("\n")


@dataclass(frozen=True)
class Location:
    """Where a directory lies within a git repository."""

    top: Path  # resolved: the working tree's top level, or the git directory if bare
    main: Path | None  # for a linked worktree: its main working tree or bare git directory


_LOCATE_LINES = 4


def locate(path: Path) -> Location:
    """The git repository that `path` lies in; raises GitError if none."""
    result = _git(
        path,
        "rev-parse",
        "--is-bare-repository",
        "--is-inside-work-tree",
        "--absolute-git-dir",
        "--git-common-dir",
    )
    if result.returncode != 0:
        raise GitError(f"{path} is not in a git repository")
    lines = result.stdout.removesuffix("\n").split("\n")
    if len(lines) != _LOCATE_LINES:
        raise GitError(f"unexpected output from `git rev-parse` in {path}")
    bare, inside, git_dir, common_dir = lines
    if bare == "true":
        top = Path(git_dir).resolve()
    elif inside == "true":
        top = Path(_output(path, "rev-parse", "--show-toplevel")).resolve()
    else:
        raise GitError(f"{path} is inside a git directory, not a working tree")

    main = None
    if Path(git_dir).resolve() != (path / common_dir).resolve():
        # The first entry of `worktree list` is the main working tree, or the bare repository.
        first = _output(path, "worktree", "list", "--porcelain").split("\n", 1)[0]
        main = Path(first.removeprefix("worktree ")).resolve()
    return Location(top=top, main=main)


@dataclass(frozen=True)
class Snapshot:
    """What git says about a repository at one moment."""

    bare: bool
    head: str | None  # None before the first commit
    branch: str | None  # None when HEAD is detached
    root_commits: tuple[str, ...]  # sorted
    remotes: Mapping[str, str]  # name → URL without credentials


def snapshot(top: Path) -> Snapshot:
    """The current facts about the repository at `top`."""
    bare = _output(top, "rev-parse", "--is-bare-repository") == "true"
    head_result = _git(top, "rev-parse", "--verify", "--quiet", "HEAD")
    head = head_result.stdout.strip() if head_result.returncode == 0 else None
    branch_result = _git(top, "symbolic-ref", "--quiet", "--short", "HEAD")
    branch = branch_result.stdout.strip() if branch_result.returncode == 0 else None
    return Snapshot(
        bare=bare,
        head=head,
        branch=branch,
        root_commits=root_commits(top, include_head=head is not None),
        remotes=remotes(top),
    )


def root_commits(top: Path, *, include_head: bool = True) -> tuple[str, ...]:
    """The commits without parents, reachable from HEAD and all local and remote branches."""
    refs = ["HEAD"] if include_head else []
    output = _output(top, "rev-list", "--max-parents=0", *refs, "--branches", "--remotes")
    return tuple(sorted(set(output.split()))) if output else ()


def remotes(top: Path) -> dict[str, str]:
    """The remotes' names and URLs, without credentials."""
    result = _git(top, "config", "-z", "--get-regexp", r"^remote\..*\.url$")
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
