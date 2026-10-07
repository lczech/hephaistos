"""Times the observation of Clones and Worktrees, as the Watcher runs it.

Registers the git repositories found under the given directories, and optionally synthetic
ones with Worktrees, in a temporary HEPHAISTOS_HOME; the real one is never touched. Then
observes them repeatedly, after a warm-up, and shows where the time goes.

    uv run scripts/bench_observe.py ~/Repos --synthetic 6 --runs 10
"""

import argparse
import os
import statistics
import subprocess
import tempfile
import threading
import time
from collections import defaultdict
from collections.abc import Callable, Generator
from contextlib import AbstractContextManager, contextmanager
from dataclasses import dataclass, field
from pathlib import Path

from hephaistos.core.db.sessions import WriteSession, write_session
from hephaistos.core.observers import clones as observer
from hephaistos.core.registry import clones, machines, repositories
from hephaistos.core.utils import git
from hephaistos.core.utils.paths import Paths

DEPTH = 2  # how deep below each directory to look for repositories
FILES = 2000  # per synthetic repository, in directories of 100
COMMITS = 30


def found_repositories(directory: Path) -> list[Path]:
    """The repositories with a `.git` directory at most DEPTH levels below `directory`."""
    found: list[Path] = []
    for root, dirs, _ in os.walk(directory):
        if ".git" in dirs:
            found.append(Path(root))
        depth = len(Path(root).relative_to(directory).parts)
        dirs[:] = [d for d in dirs if d != ".git" and depth < DEPTH]
    return sorted(found)


def synthetic(path: Path, worktrees: int) -> Path:
    """A repository with history, a pushed remote, and dirty Worktrees."""
    env = {
        **os.environ,
        "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_CONFIG_NOSYSTEM": "1",
        **{f"GIT_{role}_{key}": value for role in ("AUTHOR", "COMMITTER")
           for key, value in (("NAME", "Bench"), ("EMAIL", "bench@example.com"))},
    }  # fmt: skip

    def run(*args: str) -> None:
        subprocess.run(["git", "-C", str(path), *args], check=True, capture_output=True, env=env)  # noqa: S603, S607

    origin = path.with_name(f"{path.name}-origin.git")
    path.mkdir()
    run("init", "--quiet", "--initial-branch=main")
    run("init", "--quiet", "--bare", str(origin))
    run("remote", "add", "origin", str(origin))
    for number in range(FILES):
        file = path / "src" / f"d{number // 100}" / f"f{number}.txt"
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(f"{path.name} {number}\n")
    run("add", "--all")
    run("commit", "--quiet", "--message", "initial")
    for number in range(COMMITS):
        with (path / "src" / "d0" / "f0.txt").open("a") as file:
            file.write(f"{number}\n")
        run("commit", "--quiet", "--all", "--message", f"change {number}")
    run("push", "--quiet", "--set-upstream", "origin", "main")
    for number in range(worktrees):
        tree = path.with_name(f"{path.name}-wt{number}")
        run("worktree", "add", "--quiet", "-b", f"task{number}", str(tree))
        with (tree / "src" / "d1" / f"f{100 + number}.txt").open("a") as file:
            file.write("dirty\n")
        (tree / f"untracked{number}.txt").write_text("new\n")
    with (path / "src" / "d2" / "f200.txt").open("a") as file:
        file.write("dirty\n")
    return path


def register(session: WriteSession, path: Path, names: set[str]) -> None:
    """Adds the repository at `path` as a Clone of a new Repository named after it."""
    name = path.name
    while name in names:
        name += "_"
    names.add(name)
    repositories.add(session, name)
    clones.add(session, name, clones.inspect(path))


@dataclass
class Timings:
    """Times git commands, Clone observations and database sessions while observing."""

    lock: threading.Lock = field(default_factory=threading.Lock)
    commands: defaultdict[str, list[float]] = field(default_factory=lambda: defaultdict(list))
    clones: defaultdict[str, float] = field(default_factory=lambda: defaultdict(float))
    sessions: defaultdict[str, float] = field(default_factory=lambda: defaultdict(float))

    def install(self) -> None:
        """Wraps what is timed: git's runner, the Clone observation, the sessions."""
        run_git = git._git  # noqa: SLF001 # pyright: ignore[reportPrivateUsage] - runs every git command

        def timed_git(path: Path, *args: str, timeout: float = git.TIMEOUT) -> object:
            start = time.perf_counter()
            try:
                return run_git(path, *args, timeout=timeout)
            finally:
                name = " ".join(arg for arg in args[:2] if not arg.startswith("-"))
                with self.lock:
                    self.commands[name].append(time.perf_counter() - start)

        observe_clone = observer.clone_observation

        def timed_clone(known: observer.Known, timeout: float) -> observer.CloneObservation:
            start = time.perf_counter()
            try:
                return observe_clone(known, timeout)
            finally:
                with self.lock:
                    self.clones[str(known.path)] += time.perf_counter() - start

        def timed_session(
            name: str, session: Callable[[Paths], AbstractContextManager[object]]
        ) -> Callable[[Paths], AbstractContextManager[object]]:
            @contextmanager
            def timed(paths: Paths) -> Generator[object]:
                start = time.perf_counter()
                with session(paths) as opened:
                    yield opened
                self.sessions[name] += time.perf_counter() - start

            return timed

        git._git = timed_git  # noqa: SLF001 # pyright: ignore[reportPrivateUsage]
        observer.clone_observation = timed_clone
        for name in ("read_session", "write_session"):
            setattr(observer, name, timed_session(name, getattr(observer, name)))

    def clear(self) -> None:
        """Forgets what was timed so far."""
        self.commands.clear()
        self.clones.clear()
        self.sessions.clear()

    def report(self, runs: int, totals: list[float], result: observer.Result) -> None:
        """Prints the timings, per run."""
        ms = 1000 / runs
        print(
            f"{result.observed} Clones, {result.worktrees} Worktrees, {observer.WORKERS} workers, "
            f"{runs} runs\nobserve(): median {statistics.median(totals) * 1000:.0f} ms, "
            f"min {min(totals) * 1000:.0f}, max {max(totals) * 1000:.0f}"
        )
        for name, total in self.sessions.items():
            print(f"  {name}: {total * ms:.0f} ms")
        calls = sum(len(times) for times in self.commands.values())
        summed = sum(sum(times) for times in self.commands.values())
        print(f"git: {calls / runs:.0f} calls, {summed * ms:.0f} ms summed over workers")
        for name, times in sorted(self.commands.items(), key=lambda item: -sum(item[1])):
            print(
                f"  {name:16} {len(times) / runs:5.0f} calls  {sum(times) * ms:5.0f} ms  "
                f"avg {statistics.mean(times) * 1000:5.1f}  max {max(times) * 1000:5.1f}"
            )
        print("slowest Clones, with their Worktrees' listing but not their status:")
        for path, total in sorted(self.clones.items(), key=lambda item: -item[1])[:5]:
            print(f"  {total * ms:5.0f} ms  {path}")


def main() -> None:
    """Parses the arguments, sets up the temporary home, and runs the benchmark."""
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n\n")[0])
    parser.add_argument("directories", nargs="*", type=Path, help="where to look for repositories")
    parser.add_argument("--synthetic", type=int, default=0, help="synthetic repositories to add")
    parser.add_argument("--worktrees", type=int, default=4, help="per synthetic repository")
    parser.add_argument("--runs", type=int, default=10)
    parser.add_argument("--workers", type=int, default=observer.WORKERS)
    args = parser.parse_args()

    with tempfile.TemporaryDirectory(prefix="hephaistos-bench-") as scratch:
        os.environ["HEPHAISTOS_HOME"] = str(Path(scratch) / "home")
        paths = Paths.from_environment()
        machines.set_up(paths)
        found = [repo for directory in args.directories for repo in found_repositories(directory)]
        found += [
            synthetic(Path(scratch) / f"synthetic{number}", args.worktrees)
            for number in range(args.synthetic)
        ]
        names: set[str] = set()
        with write_session(paths) as session:
            for repo in found:
                register(session, repo, names)

        observer.WORKERS = args.workers
        timings = Timings()
        timings.install()
        observer.observe(paths)  # warm-up: starts the activity cursors, fills the disk cache
        timings.clear()
        totals: list[float] = []
        result = None
        for _ in range(args.runs):
            start = time.perf_counter()
            result = observer.observe(paths)
            totals.append(time.perf_counter() - start)
        if result is not None:
            timings.report(args.runs, totals, result)


if __name__ == "__main__":
    main()
