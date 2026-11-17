"""Helpers for tests: git repositories, running the CLI as its entry point does, free ports, a
stand-in for the Watcher, the API's schema, systemd's answers, a checkout with a Desktop, the
texts of tracked files, and waiting for a condition."""

import functools
import json
import os
import re
import socket
import subprocess
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest

from hephaistos.cli.main import run
from hephaistos.core.db.sessions import write_session
from hephaistos.core.db.tables import Table
from hephaistos.core.events.kinds import EventKind
from hephaistos.core.registry import clones, records, repositories
from hephaistos.core.registry.clones import Clone
from hephaistos.core.registry.filesystems import Filesystem
from hephaistos.core.state import clones as clone_states
from hephaistos.core.utils import logs
from hephaistos.core.utils.ids import new_id
from hephaistos.core.utils.paths import Paths
from hephaistos.core.utils.scopes import Scopes
from hephaistos.daemon.server.app import create_app
from hephaistos.daemon.server.guard import Counts
from hephaistos.daemon.status import Trigger
from hephaistos.daemon.watcher.worker import Done, PassFailed
from hephaistos.desktop import launch

ROOT = Path(__file__).parents[1]  # of the repository
NOT_OURS = {"LICENSE", "uv.lock", "gui/package-lock.json"}  # text that we do not write


@functools.cache
def tracked_texts() -> tuple[tuple[str, str], ...]:
    """Each tracked file that is text and ours, by name relative to ROOT, with its text."""
    listed = subprocess.run(
        ["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, text=True, check=True
    ).stdout
    texts: list[tuple[str, str]] = []
    for name in filter(None, listed.split("\0")):
        if name in NOT_OURS or not (ROOT / name).is_file():  # deleted, not yet staged
            continue
        try:
            texts.append((name, (ROOT / name).read_text(encoding="utf-8")))
        except UnicodeDecodeError:  # an image
            continue
    return tuple(texts)


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


def create(
    path: Path, *, commits: int = 1, origin: str | None = None, object_format: str = "sha1"
) -> Path:
    """A new repository with empty commits; their messages make its history unique."""
    path.mkdir(parents=True)
    git(path, "init", "--quiet", "--initial-branch=main", f"--object-format={object_format}")
    for number in range(commits):
        git(path, "commit", "--quiet", "--allow-empty", "--message", f"{path} {number}")
    if origin is not None:
        git(path, "remote", "add", "origin", origin)
    return path


def clone(source: Path, path: Path, *, bare: bool = False, depth: int | None = None) -> Path:
    """A clone of `source`, sharing its history, shallow with `depth`; its origin is `source`."""
    options = [*(["--bare"] if bare else []), *([f"--depth={depth}"] if depth else [])]
    url = str(source) if depth is None else source.resolve().as_uri()  # local paths ignore --depth
    git(source.parent, "clone", "--quiet", *options, url, str(path))
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


def foreign_clone(paths: Paths, repository: str, path: Path) -> Clone:
    """The repository at `path`, registered as a Clone of `repository` on a Filesystem that this
    Machine does not mount, as a Peer would have registered it."""
    filesystem = Filesystem(id=new_id(), name="peer")
    candidate = clones.inspect(path)
    with write_session(paths) as session:
        records.add(
            session, Table.REGISTRY_FILESYSTEMS, EventKind.FILESYSTEM_REGISTERED, filesystem
        )
        clone = Clone(
            id=new_id(),
            repository_id=repositories.by_name(session, repository).id,
            filesystem_id=filesystem.id,
            resolved_path=candidate.resolved_path,
            display_path=candidate.display_path,
        )
        records.add(session, Table.REGISTRY_CLONES, EventKind.CLONE_REGISTERED, clone)
        clone_states.add(session, clone.id, candidate.snapshot)
    return clone


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


@dataclass(frozen=True)
class SlowGit:
    """A git on the PATH that is the real one until `hang` exists, then writes its pid to
    `started` and sleeps."""

    hang: Path
    started: Path


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
    (checkout / "assets").mkdir()
    (checkout / "assets" / "icon.svg").write_text("<svg/>")
    return checkout


def eventually[T](check: Callable[[], T], timeout: float = 20.0) -> T:
    """The first true result of `check()`, asked every 20 ms, e.g. for what another process
    does; fails the test after `timeout` seconds.

    That bound costs nothing where `check` comes true, as it returns at once, so it is long:
    another process may take seconds on a loaded machine, e.g. with the suite run beside.
    """
    deadline = time.monotonic() + timeout
    while not (result := check()):
        if time.monotonic() > deadline:
            pytest.fail(f"not so within {timeout:g} s: {check}")
        time.sleep(0.02)
    return result


def slow_scopes(directory: Path) -> Scopes:
    """Scopes whose `systemd-run` is a stand-in, in `directory`, that starts what it runs only
    after 0.3 s: as slow as systemd can be, which the observation after creating a Terminal comes
    before. Never the systemd of the user."""
    wrapper = directory / "slow-systemd-run"
    script = 'while [ "$1" != -- ]; do shift; done; shift; sleep 0.3; exec "$@"'
    wrapper.write_text(f"#!/bin/sh\n{script}\n")
    wrapper.chmod(0o755)
    return Scopes(str(wrapper), dict(os.environ))
