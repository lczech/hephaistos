import json
from pathlib import Path

import pytest

from hephaistos.core.db.sessions import read_session, write_session
from hephaistos.core.registry import clones, machines, repositories
from hephaistos.core.registry.clones import Candidate, CloneDetails
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.git import Snapshot
from hephaistos.core.utils.paths import Paths
from support import clone, create, git


@pytest.fixture
def set_up(paths: Paths) -> Paths:
    machines.set_up(paths, "laptop")
    with write_session(paths) as session:
        repositories.add(session, "proj")
    return paths


def add(paths: Paths, path: Path, repository: str = "proj") -> CloneDetails:
    """Adds the Clone at `path` and returns it as stored."""
    candidate = clones.inspect(path)
    with write_session(paths) as session:
        clones.add(session, repository, candidate)
    with read_session(paths) as session:
        return clones.find(session, path)


def matching(paths: Paths, path: Path) -> list[str]:
    """The names of the Repositories that the repository at `path` matches."""
    candidate = clones.inspect(path)
    with read_session(paths) as session:
        return [repository.name for repository in clones.matching(session, candidate)]


def test_add_stores_clone_state_and_event(set_up: Paths, tmp_path: Path) -> None:
    repo = create(tmp_path / "repo", origin="git@host:me/proj.git")
    details = add(set_up, repo)
    assert details.repository.name == "proj"
    assert details.filesystem.name == "laptop-local"
    assert details.clone.resolved_path == repo.resolve()
    assert details.state.present
    assert details.state.head == git(repo, "rev-parse", "HEAD")
    assert details.state.remotes == {"origin": "git@host:me/proj.git"}
    with read_session(set_up) as session:
        row = session.conn.execute(
            "SELECT payload FROM events WHERE kind = 'clone.added'"
        ).fetchone()
    assert json.loads(row["payload"])["resolved_path"] == str(repo.resolve())


def test_add_keeps_the_typed_path(set_up: Paths, tmp_path: Path) -> None:
    repo = create(tmp_path / "repo")
    (repo / "sub").mkdir()
    (tmp_path / "link").symlink_to(repo)
    details = add(set_up, tmp_path / "link" / "sub")
    assert details.clone.display_path == tmp_path / "link"
    assert details.clone.resolved_path == repo.resolve()


def test_matching_by_root_commit_or_remote(set_up: Paths, tmp_path: Path) -> None:
    first = create(tmp_path / "first", origin="https://host/me/proj.git")
    add(set_up, first)
    assert matching(set_up, clone(first, tmp_path / "copy")) == ["proj"]
    fresh = create(tmp_path / "fresh", commits=0, origin="git@host:me/proj")
    assert matching(set_up, fresh) == ["proj"]
    assert matching(set_up, create(tmp_path / "other")) == []


def test_same_remote_with_unrelated_history_does_not_match(set_up: Paths, tmp_path: Path) -> None:
    add(set_up, create(tmp_path / "first", origin="https://host/me/proj.git"))
    assert matching(set_up, create(tmp_path / "recreated", origin="https://host/me/proj")) == []


def test_add_twice_fails(set_up: Paths, tmp_path: Path) -> None:
    repo = create(tmp_path / "repo")
    add(set_up, repo)
    with pytest.raises(HephaistosError, match="already a Clone of proj"):
        add(set_up, repo)


def test_add_refuses_unrelated_history(set_up: Paths, tmp_path: Path) -> None:
    add(set_up, create(tmp_path / "repo"))
    with pytest.raises(HephaistosError, match="shares no history"):
        add(set_up, create(tmp_path / "other"))


def test_add_without_commits_is_allowed(set_up: Paths, tmp_path: Path) -> None:
    add(set_up, create(tmp_path / "repo"))
    empty = tmp_path / "empty"
    empty.mkdir()
    git(empty, "init", "--quiet")
    assert add(set_up, empty).state.head is None


def test_worktree_is_refused(tmp_path: Path) -> None:
    repo = create(tmp_path / "repo")
    git(repo, "worktree", "add", "--quiet", str(tmp_path / "wt"))
    with pytest.raises(HephaistosError, match="Worktree of the Clone at"):
        clones.inspect(tmp_path / "wt")


def test_bare_clone(set_up: Paths, tmp_path: Path) -> None:
    bare = clone(create(tmp_path / "repo"), tmp_path / "bare.git", bare=True)
    details = add(set_up, bare)
    assert details.state.bare
    assert details.clone.resolved_path == bare.resolve()


def test_find_innermost(set_up: Paths, tmp_path: Path) -> None:
    outer = create(tmp_path / "outer")
    add(set_up, outer)
    with write_session(set_up) as session:
        repositories.add(session, "inner")
    inner = create(outer / "inner")
    add(set_up, inner, "inner")
    with read_session(set_up) as session:
        assert clones.find(session, outer).repository.name == "proj"
        assert clones.find(session, inner).repository.name == "inner"
        with pytest.raises(HephaistosError, match="no Clone or Worktree known"):
            clones.find(session, tmp_path)


def test_remove_and_add_again(set_up: Paths, tmp_path: Path) -> None:
    repo = create(tmp_path / "repo")
    first = add(set_up, repo)
    with write_session(set_up) as session:
        clones.remove(session, repo)
    with read_session(set_up) as session:
        assert clones.details(session) == []
        [summary] = repositories.summaries(session)
    assert summary.clones == 0
    assert add(set_up, repo).clone.id != first.clone.id


@pytest.mark.parametrize(
    ("remotes", "path", "expected"),
    [
        ({"origin": "git@host:me/hephaistos.git", "fork": "x/fork"}, "/a/b", "hephaistos"),
        ({"upstream": "https://host/me/tools"}, "/a/b", "tools"),
        ({}, "/a/b", "b"),
        ({}, "/a/b.git", "b"),
        ({}, "/a/b/.bare", "b"),
    ],
)
def test_suggested_name(remotes: dict[str, str], path: str, expected: str) -> None:
    snapshot = Snapshot(
        bare=False,
        head=None,
        branch=None,
        root_commits=(),
        remotes=remotes,
        branches=(),
        status=None,
    )
    candidate = Candidate(resolved_path=Path(path), display_path=Path(path), snapshot=snapshot)
    assert candidate.suggested_name == expected
