import dataclasses
import logging
import os
from pathlib import Path

import pytest

from hephaistos.core import config
from hephaistos.core.utils import commit_graph
from hephaistos.core.utils.history import history
from support import create, git


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    return create(tmp_path / "repo", commits=3)


def _info(repo: Path) -> Path:
    return Path(git(repo, "rev-parse", "--path-format=absolute", "--git-path", "objects/info"))


def _age_files(repo: Path, seconds: float) -> None:
    """Makes the files of the commit-graph `seconds` older."""
    for path in _info(repo).rglob("commit-graph*"):
        stat = path.stat()
        os.utime(path, (stat.st_atime - seconds, stat.st_mtime - seconds))


def test_written_where_missing_then_not_again_for_a_day(repo: Path) -> None:
    assert commit_graph.age(repo) is None
    assert commit_graph.due(repo)
    thread = commit_graph.refresh_soon(repo)
    assert thread is not None
    thread.join()
    found = commit_graph.age(repo)
    assert found is not None
    assert found < 60
    git(repo, "commit-graph", "verify")
    assert not commit_graph.due(repo)
    assert commit_graph.refresh_soon(repo) is None


def test_written_again_once_a_day_old_with_the_new_commits(repo: Path) -> None:
    assert commit_graph.write(repo)
    git(repo, "commit", "--quiet", "--allow-empty", "--message", "newer")
    _age_files(repo, commit_graph.REFRESH + 60)
    assert commit_graph.due(repo)  # in a later process, or a day later
    thread = commit_graph.refresh_soon(repo)
    assert thread is not None
    thread.join()
    assert (commit_graph.age(repo) or 1e9) < 60
    chain = _info(repo) / "commit-graphs" / "commit-graph-chain"
    assert chain.is_file()  # in layers: the newest commits added to the old ones
    git(repo, "commit-graph", "verify")


def test_shared_by_the_worktrees_of_a_clone(repo: Path, tmp_path: Path) -> None:
    worktree = tmp_path / "wt"
    git(repo, "worktree", "add", "--quiet", "--detach", str(worktree))
    thread = commit_graph.refresh_soon(worktree)
    assert thread is not None
    thread.join()
    assert commit_graph.age(repo) is not None
    assert not commit_graph.due(repo)  # tried once for the Clone, whichever Checkout asked


def test_not_written_when_turned_off(repo: Path) -> None:
    git_settings = dataclasses.replace(config.DEFAULTS.git, write_commit_graph=False)
    config.activate(dataclasses.replace(config.DEFAULTS, git=git_settings))
    assert not commit_graph.due(repo)
    assert commit_graph.refresh_soon(repo) is None
    assert commit_graph.age(repo) is None


def test_a_failed_write_is_logged_tried_once_a_day_and_the_walk_goes_on(
    repo: Path, caplog: pytest.LogCaptureFixture
) -> None:
    layers = _info(repo) / "commit-graphs"
    layers.mkdir(parents=True)
    (layers / "commit-graph-chain.lock").write_text("")  # as while the git of the user writes it
    with caplog.at_level(logging.WARNING):
        thread = commit_graph.refresh_soon(repo)
        assert thread is not None
        thread.join()
    assert "Could not write the commit-graph file in" in caplog.text
    assert "commit-graph-chain.lock': File exists" in caplog.text
    assert commit_graph.age(repo) is None
    assert not commit_graph.due(repo)  # not again for a day
    assert len(history(repo, order="topo", limit=10).commits) == 3


def test_not_written_into_a_read_only_repository(repo: Path) -> None:
    objects = _info(repo).parent
    modes = {path: path.stat().st_mode for path in [objects, *objects.rglob("*")] if path.is_dir()}
    for path in modes:
        path.chmod(0o555)
    try:
        if os.access(objects, os.W_OK):
            pytest.skip("this user writes to read-only directories, e.g. root")
        assert not commit_graph.write(repo)
        assert len(history(repo, order="date", limit=10).commits) == 3
    finally:
        for path, mode in modes.items():
            path.chmod(mode)


def test_written_once_however_often_asked_at_once(repo: Path) -> None:
    threads = [commit_graph.refresh_soon(repo) for _ in range(5)]
    started = [thread for thread in threads if thread is not None]
    assert len(started) == 1
    started[0].join()
    assert commit_graph.age(repo) is not None


def test_nothing_for_a_directory_that_is_not_a_repository(tmp_path: Path) -> None:
    assert not commit_graph.due(tmp_path)
    assert commit_graph.refresh_soon(tmp_path) is None
    assert commit_graph.age(tmp_path) is None


def test_settled_between_tests_waits_for_writes(repo: Path) -> None:
    thread = commit_graph.refresh_soon(repo)
    assert thread is not None
    commit_graph.settle()
    assert not thread.is_alive()
    assert commit_graph.due(repo) is False  # written now, and young
    _age_files(repo, commit_graph.REFRESH + 60)
    assert commit_graph.due(repo)  # forgotten when tried: due by its age alone
