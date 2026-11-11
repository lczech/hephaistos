"""The commit-graph file of git in a Clone, a cache of its commits and their parents.

It lets git list commits in topological or date order without walking all of them first: on the
repository of git, 0.8 s a page without it, 15 ms with it.

It is the one thing the Daemon writes into a repository by itself (ADR 004): where it is missing or
a day old, in the background, with `git commit-graph write --reachable --split`, which adds only the
commits new since; at most once a day per Clone in this process, whether it worked or not. Where
it cannot be written, e.g. on a read-only filesystem or while the git of the user holds its lock,
walks go on without it, only slower.
"""

import logging
import threading
import time
from pathlib import Path

from hephaistos.core import config
from hephaistos.core.utils import git

log = logging.getLogger(__name__)

REFRESH = 24 * 3600.0  # s: how old the file may grow, and how often a Clone is tried
WRITE_TIMEOUT = 600.0  # s: writing walks all commits once, which in large repositories takes long
_FILES = ("commit-graph", "commit-graphs/commit-graph-chain")  # whole, or in layers (`--split`)

_lock = threading.Lock()
_tried: dict[Path, float] = {}  # the object directory of a Clone → when last tried, monotonic
_running: dict[Path, threading.Thread] = {}


def _objects(top: Path) -> Path | None:
    """The directory `objects/info` of the repository at `top`, shared by its Worktrees."""
    found = git.run(top, "rev-parse", "--path-format=absolute", "--git-path", "objects/info")
    return Path(found.stdout.strip()) if found.returncode == 0 else None


def age(top: Path) -> float | None:
    """How old the commit-graph file of the repository at `top` is, in seconds; None if missing."""
    info = _objects(top)
    if info is None:
        return None
    ages = [
        time.time() - (info / name).stat().st_mtime for name in _FILES if (info / name).is_file()
    ]
    return min(ages) if ages else None


def due(top: Path) -> bool:
    """Whether to write the file for `top` now: allowed, missing or old, not tried for a day."""
    if not config.settings().git.write_commit_graph:
        return False
    info = _objects(top)
    if info is None:
        return False
    with _lock:
        tried = _tried.get(info)
        if info in _running or (tried is not None and time.monotonic() - tried < REFRESH):
            return False
    found = age(top)
    return found is None or found >= REFRESH


def write(top: Path) -> bool:
    """Writes or adds to the file of the repository at `top`; whether it worked, logged if not."""
    try:
        result = git.run(
            top, "commit-graph", "write", "--reachable", "--split", timeout=WRITE_TIMEOUT
        )
    except git.GitError as error:
        log.warning("Could not write the commit-graph file in %s: %s", top, error)
        return False
    if result.returncode != 0:
        reason = result.stderr.strip().splitlines()[:1] or ["no reason given"]  # git says why first
        log.warning("Could not write the commit-graph file in %s: %s", top, reason[0])
        return False
    log.info("Wrote the commit-graph file in %s", top)
    return True


def refresh_soon(top: Path) -> threading.Thread | None:
    """Writes the file for `top` in the background if due; the thread doing so, if any.

    Apart from the passes of the Watcher and from requests, which go on without waiting for it.
    """
    if not due(top):
        return None
    info = _objects(top)
    if info is None:
        return None
    with _lock:
        if info in _running:
            return None
        _tried[info] = time.monotonic()
        thread = threading.Thread(
            target=_write_then_forget, args=(top, info), name="commit-graph", daemon=True
        )
        _running[info] = thread
    thread.start()
    return thread


def _write_then_forget(top: Path, info: Path) -> None:
    try:
        write(top)
    finally:
        with _lock:
            _running.pop(info, None)


def settle() -> None:
    """Waits for the writes running, then forgets when each Clone was tried: between tests."""
    with _lock:
        running = list(_running.values())
    for thread in running:
        thread.join()
    with _lock:
        _tried.clear()
