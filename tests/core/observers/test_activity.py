"""Git activity, read from reflogs that real git commands wrote."""

import shutil
import subprocess
from pathlib import Path

import pytest

from hephaistos.core.db.sessions import read_session, write_session
from hephaistos.core.events import subjects
from hephaistos.core.events.kinds import Priority
from hephaistos.core.observers import clones as observer
from hephaistos.core.registry import clones, machines, repositories
from hephaistos.core.utils.paths import Paths
from support import clone, create, git


@pytest.fixture
def origin(tmp_path: Path) -> Path:
    """A bare repository to push to and pull from."""
    return clone(create(tmp_path / "source"), tmp_path / "origin.git", bare=True)


def _add(paths: Paths, repo: Path, *, import_history: bool = False) -> None:
    """Adds `repo` as a Clone of Repository `proj`, created if needed."""
    candidate = clones.inspect(repo)
    with write_session(paths) as session:
        if not repositories.summaries(session):
            repositories.add(session, "proj")
        clones.add(session, "proj", candidate, import_history=import_history)


@pytest.fixture
def repo(paths: Paths, origin: Path, tmp_path: Path) -> Path:
    """Clone `repo` of `origin`, observed once, so that its git activity counts from now."""
    machines.set_up(paths, "laptop")
    repo = clone(origin, tmp_path / "repo")
    _add(paths, repo)
    observer.observe(paths)
    return repo


def _commit(path: Path, message: str, *args: str) -> str:
    git(path, "commit", "--quiet", "--allow-empty", "--message", message, *args)
    return git(path, "rev-parse", "HEAD")


def _kinds(result: observer.Result) -> list[str]:
    return [event.kind for event in result.events]


def test_commits_count_from_the_first_observation(
    paths: Paths, origin: Path, tmp_path: Path
) -> None:
    machines.set_up(paths, "laptop")
    repo = clone(origin, tmp_path / "repo")
    _commit(repo, "before")
    _add(paths, repo)
    _commit(repo, "added, not observed yet")
    assert observer.observe(paths).events == []

    before = git(repo, "rev-parse", "HEAD")
    after = _commit(repo, "Fix it")
    [event] = observer.observe(paths).events
    assert (event.kind, event.priority) == ("clone.committed", Priority.LOW)
    assert event.payload["head"] == {"old": before, "new": after}
    assert (event.payload["subject"], event.payload["how"]) == ("Fix it", "commit")
    assert event.occurred_at is not None
    assert event.key is not None
    assert observer.observe(paths).events == []


def test_import_history(paths: Paths, origin: Path, tmp_path: Path) -> None:
    machines.set_up(paths, "laptop")
    repo = clone(origin, tmp_path / "repo")
    _commit(repo, "earlier")
    git(repo, "worktree", "add", "--quiet", "-b", "side", str(tmp_path / "side"))
    _commit(tmp_path / "side", "on the side")
    _add(paths, repo, import_history=True)
    kinds = _kinds(observer.observe(paths))
    assert kinds == ["clone.head_moved", "clone.committed", "worktree.added", "worktree.committed"]


def test_more_entries_than_a_page(
    paths: Paths, repo: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(observer, "PAGE", 2)
    # Dated before the cursor, so that only finding it on a further page reads them.
    monkeypatch.setenv("GIT_COMMITTER_DATE", "2001-01-01T00:00:00Z")
    commits = [_commit(repo, f"Commit {number}") for number in range(5)]
    result = observer.observe(paths)
    assert _kinds(result) == ["clone.committed"] * 5
    assert [event.payload["head"]["new"] for event in result.events] == commits
    assert observer.observe(paths).events == []


def test_cursor_entry_gone_reads_what_is_newer(
    paths: Paths, repo: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("GIT_COMMITTER_DATE", "2090-01-01T00:00:00Z")
    commits = [_commit(repo, f"Commit {number}") for number in range(2)]
    git(repo, "reflog", "delete", "HEAD@{2}")  # the entry the cursor names, as if expired
    result = observer.observe(paths)
    assert [event.payload["head"]["new"] for event in result.events] == commits
    assert observer.observe(paths).events == []


def test_amend_switch_reset_and_stash(paths: Paths, repo: Path) -> None:
    first = _commit(repo, "First")
    _commit(repo, "First, better", "--amend")
    git(repo, "switch", "--quiet", "--create", "feature")
    git(repo, "reset", "--quiet", "--hard", "HEAD~1")
    (repo / "README").write_text("x")
    git(repo, "add", "README")
    git(repo, "stash", "--quiet")
    result = observer.observe(paths)
    assert _kinds(result) == [
        "clone.branch_created",
        "clone.committed",
        "clone.committed",
        "clone.branch_switched",
        "clone.reset",
    ]
    amended = result.events[2].payload
    assert (amended["how"], amended["amends"]) == ("amend", first)
    assert result.events[3].payload["branch"] == {"old": "main", "new": "feature"}
    assert result.events[4].payload["target"] == "HEAD~1"


def test_merge_push_and_pull(paths: Paths, repo: Path, origin: Path, tmp_path: Path) -> None:
    git(repo, "switch", "--quiet", "--create", "feature")
    _commit(repo, "Feature")
    git(repo, "switch", "--quiet", "main")
    git(repo, "merge", "--quiet", "--no-ff", "--no-edit", "feature")
    git(repo, "push", "--quiet", "origin", "main")
    result = observer.observe(paths)
    assert _kinds(result)[-2:] == ["clone.merged", "clone.pushed"]
    merged, pushed = result.events[-2].payload, result.events[-1].payload
    assert (merged["source"], merged["fast_forward"]) == ("feature", False)
    assert pushed["branch"] == "origin/main"
    assert pushed["commit"]["new"] == git(repo, "rev-parse", "HEAD")

    other = clone(origin, tmp_path / "other")
    _commit(other, "Elsewhere")
    git(other, "push", "--quiet", "origin", "main")
    git(repo, "pull", "--quiet", "--ff-only")
    [pulled] = observer.observe(paths).events  # the fetch it made is no push
    assert (pulled.kind, pulled.payload["how"]) == ("clone.pulled", "fast-forward")


def test_rebase_waits_until_finished(paths: Paths, repo: Path) -> None:
    (repo / "file").write_text("main")
    git(repo, "add", "file")
    _commit(repo, "On main")
    git(repo, "switch", "--quiet", "--create", "feature", "HEAD~1")
    (repo / "file").write_text("feature")
    git(repo, "add", "file")
    _commit(repo, "On feature")
    _commit(repo, "More on feature")
    observer.observe(paths)

    with pytest.raises(subprocess.CalledProcessError):
        git(repo, "rebase", "main")
    assert observer.observe(paths).events == []
    (repo / "file").write_text("both")
    git(repo, "add", "file")
    git(repo, "-c", "core.editor=true", "rebase", "--continue")
    [rebased] = observer.observe(paths).events
    assert rebased.kind == "clone.rebased"
    assert (rebased.payload["commits"], rebased.payload["branch"]) == (2, "feature")


def test_quit_rebase_and_work_after_it(paths: Paths, repo: Path) -> None:
    (repo / "file").write_text("main")
    git(repo, "add", "file")
    _commit(repo, "On main")
    git(repo, "switch", "--quiet", "--create", "feature", "HEAD~1")
    (repo / "file").write_text("feature")
    git(repo, "add", "file")
    _commit(repo, "On feature")
    observer.observe(paths)

    with pytest.raises(subprocess.CalledProcessError):
        git(repo, "rebase", "main")
    git(repo, "rebase", "--quit")  # leaves no reflog entry
    git(repo, "add", "file")
    _commit(repo, "After quitting")
    assert _kinds(observer.observe(paths)) == ["clone.rebased", "clone.committed"]
    _commit(repo, "Later")
    assert _kinds(observer.observe(paths)) == ["clone.committed"]


def test_branch_created_and_renamed(paths: Paths, repo: Path) -> None:
    start = git(repo, "rev-parse", "HEAD")
    git(repo, "branch", "feature")
    [created] = observer.observe(paths).events
    assert (created.payload, created.key is not None) == (
        {"branch": "feature", "start": start},
        True,
    )
    assert created.occurred_at is not None
    git(repo, "branch", "--move", "feature", "renamed")
    [renamed] = observer.observe(paths).events
    assert renamed.kind == "clone.branch_renamed"
    assert renamed.payload == {"branch": {"old": "feature", "new": "renamed"}}
    assert (renamed.occurred_at is not None, renamed.key is not None) == (True, True)


def test_worktree_activity(paths: Paths, repo: Path, tmp_path: Path) -> None:
    side = tmp_path / "side"
    git(repo, "worktree", "add", "--quiet", "-b", "side", str(side))
    commit = _commit(side, "On the side")
    result = observer.observe(paths)
    assert _kinds(result) == ["clone.branch_created", "worktree.added", "worktree.committed"]
    committed = result.events[2]
    assert committed.subject == result.events[1].subject
    assert committed.payload["head"]["new"] == commit
    assert committed.payload["clone_id"] == result.events[1].payload["clone_id"]
    assert observer.observe(paths).events == []


def test_worktree_whose_history_continues_is_restored(
    paths: Paths, repo: Path, tmp_path: Path
) -> None:
    side = tmp_path / "side"
    git(repo, "worktree", "add", "--quiet", "-b", "side", str(side))
    _commit(side, "Before")
    added = observer.observe(paths).events[1]
    assert added.kind == "worktree.added"

    away = side.rename(tmp_path / "away")  # e.g. a filesystem not mounted for a while
    assert _kinds(observer.observe(paths)) == ["worktree.removed"]
    commit = _commit(away, "While away")
    away.rename(side)
    result = observer.observe(paths)
    assert _kinds(result) == ["worktree.restored", "worktree.committed"]
    assert {event.subject for event in result.events} == {added.subject}
    assert result.events[1].payload["head"]["new"] == commit

    moved = side.rename(tmp_path / "moved")  # by hand, then repaired
    assert _kinds(observer.observe(paths)) == ["worktree.removed"]
    git(moved, "worktree", "repair")
    assert _kinds(observer.observe(paths)) == ["worktree.restored", "worktree.moved"]
    with read_session(paths) as session:
        [current] = clones.find(session, repo).worktrees
    assert (current.id, current.path) == (added.subject, moved)


def test_removed_worktree_is_kept_and_its_name_reused(
    paths: Paths, repo: Path, tmp_path: Path
) -> None:
    side = tmp_path / "side"
    git(repo, "worktree", "add", "--quiet", "-b", "side", str(side))
    # Else the new one's reflog might equal it, if made within the same second.
    _commit(side, "Its own history")
    added = observer.observe(paths).events[1]
    assert added.kind == "worktree.added"
    shutil.rmtree(side)
    git(repo, "worktree", "prune")
    [removed] = observer.observe(paths).events
    assert (removed.kind, removed.subject) == ("worktree.removed", added.subject)

    git(repo, "worktree", "add", "--quiet", str(side), "side")
    [again] = observer.observe(paths).events
    assert again.kind == "worktree.added"
    assert again.subject != added.subject
    with read_session(paths) as session:
        [current] = clones.find(session, repo).worktrees
        assert current.id == again.subject
        assert subjects.labels(session, [added]) == {added.subject: side}
