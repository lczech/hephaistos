"""Helpers for tests: git repositories to work on."""

import functools
import re
import subprocess
from pathlib import Path

import pytest


def git(path: Path, *args: str) -> str:
    """Runs git in `path` and returns its output, stripped."""
    result = subprocess.run(
        ["git", "-C", str(path), *args], check=True, capture_output=True, text=True
    )
    return result.stdout.strip()


def create(path: Path, *, commits: int = 1, origin: str | None = None) -> Path:
    """A new repository with empty commits; their messages make its history unique."""
    path.mkdir(parents=True)
    git(path, "init", "--quiet", "--initial-branch=main")
    for number in range(commits):
        git(path, "commit", "--quiet", "--allow-empty", "--message", f"{path} {number}")
    if origin is not None:
        git(path, "remote", "add", "origin", origin)
    return path


def clone(source: Path, path: Path, *, bare: bool = False) -> Path:
    """A clone of `source`, sharing its history; its origin is `source`."""
    git(source.parent, "clone", "--quiet", *(["--bare"] if bare else []), str(source), str(path))
    return path


def submodule(source: Path, superproject: Path, name: str) -> Path:
    """`source` added to `superproject` as a submodule at `name`, committed."""
    git(
        superproject,
        "-c",
        "protocol.file.allow=always",
        "submodule",
        "add",
        "--quiet",
        str(source),
        name,
    )
    git(superproject, "commit", "--quiet", "--message", f"add {name}")
    return superproject / name


@functools.cache
def git_version() -> tuple[int, ...]:
    """The version of the git that tests run, e.g. `(2, 43, 0)`."""
    output = subprocess.run(["git", "--version"], check=True, capture_output=True, text=True)
    match = re.search(r"(\d+)\.(\d+)\.(\d+)", output.stdout)
    assert match is not None, output.stdout
    return tuple(int(part) for part in match.groups())


def needs_git(*version: int) -> pytest.MarkDecorator:
    """Skips a test with an older git; `scripts/test_git_versions.sh` runs newer ones."""
    shown = ".".join(map(str, version))
    return pytest.mark.skipif(git_version() < version, reason=f"needs git {shown}")
