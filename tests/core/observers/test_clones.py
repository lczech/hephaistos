import dataclasses
import shutil
from pathlib import Path

import pytest

from hephaistos.core.db.sessions import read_session, write_session
from hephaistos.core.events import subjects
from hephaistos.core.events.kinds import Priority
from hephaistos.core.observers import clones as observer
from hephaistos.core.registry import clones, machines, repositories
from hephaistos.core.state import clones as state
from hephaistos.core.state.clones import CloneState
from hephaistos.core.state.worktrees import WorktreeState
from hephaistos.core.utils import git as git_facts
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.paths import Paths
from support import clone, create, git


@pytest.fixture
def repo(paths: Paths, tmp_path: Path) -> Path:
    """A set-up Machine with Clone `repo` of Repository `proj`, cloned from `origin`."""
    machines.set_up(paths, "laptop")
    repo = clone(create(tmp_path / "origin"), tmp_path / "repo")
    candidate = clones.inspect(repo)
    with write_session(paths) as session:
        repositories.add(session, "proj")
        clones.add(session, "proj", candidate)
    return repo


def _kinds(result: observer.Result) -> list[str]:
    return [event.kind for event in result.events]


def _state(paths: Paths, repo: Path) -> CloneState:
    with read_session(paths) as session:
        return clones.find(session, repo).state


def test_nothing_changed(paths: Paths, repo: Path) -> None:
    before = _state(paths, repo)
    result = observer.observe(paths)
    assert (result.events, result.observed, result.skipped) == ([], 1, 0)
    after = _state(paths, repo)
    assert after.observed_at > before.observed_at
    assert after == dataclasses.replace(before, observed_at=after.observed_at)


def test_status_changes_update_state_without_events(paths: Paths, repo: Path) -> None:
    (repo / "new").write_text("x")
    git(repo, "commit", "--quiet", "--allow-empty", "--message", "ahead")
    assert observer.observe(paths).events == []
    after = _state(paths, repo)
    assert (after.untracked, after.ahead, after.behind, after.upstream) == (1, 1, 0, "origin/main")


def test_branches_and_remotes(paths: Paths, repo: Path) -> None:
    git(repo, "branch", "feature")
    result = observer.observe(paths)
    assert _kinds(result) == ["clone.branch_created"]
    assert result.events[0].payload == {"branch": "feature"}
    assert result.events[0].priority == Priority.NORMAL

    git(repo, "branch", "--delete", "feature")
    git(repo, "remote", "set-url", "origin", "git@host:me/proj.git")
    result = observer.observe(paths)
    assert _kinds(result) == ["clone.branch_deleted", "clone.remotes_changed"]
    assert result.events[1].payload == {
        "origin": {"old": str(repo.parent / "origin"), "new": "git@host:me/proj.git"}
    }


def test_missing_keeps_the_last_known_state_then_found(paths: Paths, repo: Path) -> None:
    git(repo, "switch", "--quiet", "--create", "feature")
    observer.observe(paths)
    moved = repo.rename(repo.parent / "moved")
    result = observer.observe(paths)
    assert _kinds(result) == ["clone.missing"]
    assert result.events[0].priority == Priority.HIGH
    missing = _state(paths, repo)
    assert (missing.present, missing.branch) == (False, "feature")
    assert observer.observe(paths).events == []

    moved.rename(repo)
    assert _kinds(observer.observe(paths)) == ["clone.found"]
    assert _state(paths, repo).present


def test_directory_without_repository_is_missing(paths: Paths, repo: Path) -> None:
    shutil.rmtree(repo / ".git")
    assert _kinds(observer.observe(paths)) == ["clone.missing"]


def test_other_repository_at_the_path_fails(paths: Paths, repo: Path) -> None:
    shutil.rmtree(repo)
    create(repo)
    result = observer.observe(paths)
    assert _kinds(result) == ["clone.failed"]
    assert "shares no history" in result.events[0].payload["error"]
    assert _state(paths, repo).error is not None


@pytest.mark.usefixtures("repo")
def test_timeout_fails_then_recovers(paths: Paths) -> None:
    result = observer.observe(paths, timeout=1e-6)
    assert _kinds(result) == ["clone.failed"]
    assert "timed out" in result.events[0].payload["error"]
    assert _kinds(observer.observe(paths)) == ["clone.recovered"]


def test_only_given_clones(paths: Paths, repo: Path, tmp_path: Path) -> None:
    other = create(tmp_path / "other")
    candidate = clones.inspect(other)
    with write_session(paths) as session:
        repositories.add(session, "other")
        clones.add(session, "other", candidate)
        repo_id = clones.find(session, repo).clone.id
    assert observer.observe(paths).observed == 2
    assert observer.observe(paths, [repo_id]).observed == 1


def test_fresher_observation_is_kept(
    paths: Paths, repo: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    real = observer.clone_observation

    def observe_while_another_process_writes(
        path: Path, timeout: float
    ) -> tuple[state.Observation, tuple[git_facts.LinkedWorktree, ...] | None]:
        with write_session(paths) as session:
            state.update(session, clones.find(session, path).clone.id, git_facts.snapshot(path))
        return real(path, timeout)

    monkeypatch.setattr(observer, "clone_observation", observe_while_another_process_writes)
    git(repo, "branch", "feature")
    result = observer.observe(paths)
    assert (result.events, result.observed, result.skipped) == ([], 0, 1)
    with read_session(paths) as session:
        kinds = [row[0] for row in session.conn.execute("SELECT kind FROM events")]
    assert kinds.count("clone.branch_created") == 1


def _worktree(paths: Paths, path: Path) -> WorktreeState:
    with read_session(paths) as session:
        worktree = clones.find_checkout(session, path).worktree
    assert worktree is not None
    return worktree


def test_worktree_added_moved_and_removed(paths: Paths, repo: Path, tmp_path: Path) -> None:
    git(repo, "worktree", "add", "--quiet", "-b", "feature", str(tmp_path / "feature"))
    result = observer.observe(paths)
    assert _kinds(result) == ["clone.branch_created", "worktree.added"]
    assert (result.observed, result.worktrees) == (1, 1)
    added = result.events[1]
    assert added.payload["branch"] == "feature"
    assert added.payload["clone_id"] == str(_state(paths, repo).clone_id)
    first = _worktree(paths, tmp_path / "feature")
    assert (first.name, first.branch, first.staged) == ("feature", "feature", 0)

    git(repo, "worktree", "move", str(tmp_path / "feature"), str(tmp_path / "moved"))
    (tmp_path / "moved" / "new").write_text("x")
    result = observer.observe(paths)
    assert _kinds(result) == ["worktree.moved"]
    assert result.events[0].payload["path"] == {
        "old": str(tmp_path / "feature"),
        "new": str(tmp_path / "moved"),
    }
    moved = _worktree(paths, tmp_path / "moved")
    assert (moved.id, moved.untracked) == (first.id, 1)

    shutil.rmtree(tmp_path / "moved")
    result = observer.observe(paths)
    assert _kinds(result) == ["worktree.removed"]
    with read_session(paths) as session:
        assert clones.find(session, repo).worktrees == ()
        assert subjects.labels(session, result.events) == {first.id: tmp_path / "moved"}


def test_locked_worktree_goes_missing_and_is_found(
    paths: Paths, repo: Path, tmp_path: Path
) -> None:
    usb = tmp_path / "usb"
    git(repo, "worktree", "add", "--quiet", "-b", "usb", str(usb))
    git(repo, "worktree", "lock", "--reason", "on a stick", str(usb))
    observer.observe(paths)
    usb.rename(tmp_path / "away")
    result = observer.observe(paths)
    assert _kinds(result) == ["worktree.missing"]
    with read_session(paths) as session:
        [missing] = clones.find(session, repo).worktrees
    assert (missing.present, missing.lock_reason, missing.staged) == (False, "on a stick", 0)

    (tmp_path / "away").rename(usb)
    assert _kinds(observer.observe(paths)) == ["worktree.found"]


def test_worktree_failed_and_recovered(paths: Paths, repo: Path, tmp_path: Path) -> None:
    git(repo, "worktree", "add", "--quiet", "-b", "feature", str(tmp_path / "feature"))
    observer.observe(paths)
    link = tmp_path / "feature" / ".git"
    text = link.read_text()
    link.write_text("gitdir: /nowhere\n")
    result = observer.observe(paths)
    assert _kinds(result) == ["worktree.failed"]
    assert result.events[0].priority == Priority.HIGH
    assert result.events[0].payload["error"]
    link.write_text(text)
    assert _kinds(observer.observe(paths)) == ["worktree.recovered"]


def test_worktrees_of_a_missing_clone_stay(paths: Paths, repo: Path, tmp_path: Path) -> None:
    git(repo, "worktree", "add", "--quiet", "-b", "feature", str(repo / ".worktrees" / "feature"))
    observer.observe(paths)
    repo.rename(tmp_path / "away")
    assert _kinds(observer.observe(paths)) == ["clone.missing"]
    with read_session(paths) as session:
        [kept] = clones.find(session, repo).worktrees
    assert kept.present


def test_finding_checkouts(paths: Paths, repo: Path, tmp_path: Path) -> None:
    inside = repo / ".worktrees" / "inside"
    git(repo, "worktree", "add", "--quiet", "-b", "inside", str(inside))
    with read_session(paths) as session:
        with pytest.raises(HephaistosError, match="no Clone or Worktree known"):
            clones.find_checkout(session, tmp_path / "outside")
        assert clones.find_checkout(session, inside).worktree is None  # not observed yet
        assert clones.outdated_clone(session, inside) == clones.find(session, repo)
        assert clones.outdated_clone(session, repo) is None
    git(repo, "worktree", "add", "--quiet", "-b", "outside", str(tmp_path / "outside"))
    with read_session(paths) as session:
        assert clones.find_unobserved(session, tmp_path / "outside").clone.resolved_path == repo
    observer.observe(paths)
    with read_session(paths) as session:
        assert _worktree(paths, inside / "sub").name == "inside"
        assert clones.find(session, tmp_path / "outside").clone.resolved_path == repo
        assert clones.find_checkout(session, repo).worktree is None
    with write_session(paths) as session, pytest.raises(HephaistosError, match="in a Worktree"):
        clones.remove(session, tmp_path / "outside")
