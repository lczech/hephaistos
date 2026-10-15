"""Helpers for tests: git repositories, running the CLI as its entry point does, free ports, a
stand-in for the Watcher, the API's schema, systemd's answers, a checkout with a Desktop."""

import functools
import json
import re
import socket
import subprocess
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

import pytest

from hephaistos.cli.main import run
from hephaistos.core.utils import logs
from hephaistos.core.utils.paths import Paths
from hephaistos.daemon.server.app import create_app
from hephaistos.daemon.server.guard import Counts
from hephaistos.daemon.status import Trigger
from hephaistos.daemon.watcher.worker import Done, PassFailed
from hephaistos.desktop import launch


def hostnamectl(answers: Mapping[tuple[str, ...], str]) -> Callable[..., str | None]:
    """A stand-in for `machines.hostnamectl`: these answers, by arguments; None to others."""

    def answer(*args: str) -> str | None:
        return answers.get(args)

    return answer


def free_port() -> int:
    """A port nothing listens on now, for a Server in a test."""
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class FakeWatcher:
    """Stands in for the Watcher behind a Server: its passes end at once, as `outcome`."""

    def __init__(self) -> None:
        self.outcome: Done | PassFailed = Done(
            events=0, observed=1, worktrees=0, updated=0, skipped=0
        )
        self.triggers: list[Trigger] = []  # of the passes so far

    async def observe(self, trigger: Trigger) -> Done | PassFailed:
        """A pass's outcome."""
        self.triggers.append(trigger)
        return self.outcome


def openapi(paths: Paths) -> dict[str, Any]:
    """The API's OpenAPI schema, as the Server for `paths` describes it."""
    return create_app(paths, Counts(), "0.1.0", FakeWatcher().observe, None).openapi()


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


def run_cli(monkeypatch: pytest.MonkeyPatch, *args: str, program: str = "hephaistos") -> object:
    """Runs a command as the entry point does, run as `program`; returns its exit code."""
    monkeypatch.setattr("sys.argv", [program, *args])
    with pytest.raises(SystemExit) as exit_info:
        run()
    return exit_info.value.code


def logged(paths: Paths) -> list[dict[str, object]]:
    """The records in the log files."""
    return [
        json.loads(line)
        for _, path in logs.day_files(paths.state_dir)
        for line in path.read_text().splitlines()
    ]


def desktop_checkout(tmp_path: Path, electron: str | None, *, built: bool = True) -> Path:
    """A checkout whose Electron is a shell script running `electron`, if any."""
    checkout = tmp_path / "checkout"
    (checkout / launch.PACKAGE).mkdir(parents=True)
    if electron is not None:
        binary = checkout / launch.ELECTRON
        binary.parent.mkdir(parents=True)
        binary.write_text(f"#!/bin/sh\n{electron}\n")
        binary.chmod(0o755)
    if built:
        (checkout / launch.MAIN).parent.mkdir(parents=True)
        (checkout / launch.MAIN).touch()
    return checkout
