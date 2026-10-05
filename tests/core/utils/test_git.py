from pathlib import Path

import pytest

from hephaistos.core.utils.git import (
    GitError,
    locate,
    main_remote,
    normalise_remote,
    repository_name,
    snapshot,
    without_credentials,
)
from support import clone, create, git


def test_locate_from_a_subdirectory_through_a_symlink(tmp_path: Path) -> None:
    repo = create(tmp_path / "repo")
    (repo / "sub").mkdir()
    (tmp_path / "link").symlink_to(repo)
    location = locate(tmp_path / "link" / "sub")
    assert location.top == repo.resolve()
    assert location.main is None


def test_locate_bare(tmp_path: Path) -> None:
    bare = clone(create(tmp_path / "repo"), tmp_path / "bare.git", bare=True)
    (bare / "refs").mkdir(exist_ok=True)
    assert locate(bare / "refs").top == bare.resolve()


def test_locate_worktree_names_its_main(tmp_path: Path) -> None:
    repo = create(tmp_path / "repo")
    git(repo, "worktree", "add", "--quiet", str(tmp_path / "wt"))
    location = locate(tmp_path / "wt")
    assert location.top == (tmp_path / "wt").resolve()
    assert location.main == repo.resolve()


def test_locate_worktree_of_bare(tmp_path: Path) -> None:
    bare = clone(create(tmp_path / "repo"), tmp_path / "bare.git", bare=True)
    git(bare, "worktree", "add", "--quiet", str(tmp_path / "wt"))
    assert locate(tmp_path / "wt").main == bare.resolve()


def test_locate_outside_any_repository(tmp_path: Path) -> None:
    with pytest.raises(GitError, match="not in a git repository"):
        locate(tmp_path)


def test_locate_inside_git_directory(tmp_path: Path) -> None:
    repo = create(tmp_path / "repo")
    with pytest.raises(GitError, match="inside a git directory"):
        locate(repo / ".git")


def test_snapshot(tmp_path: Path) -> None:
    repo = create(tmp_path / "repo", commits=2, origin="https://user:secret@host.org/a/b.git")
    facts = snapshot(repo)
    assert not facts.bare
    assert facts.head == git(repo, "rev-parse", "HEAD")
    assert facts.branch == "main"
    assert facts.root_commits == (git(repo, "rev-list", "--max-parents=0", "HEAD"),)
    assert facts.remotes == {"origin": "https://host.org/a/b.git"}


def test_snapshot_detached(tmp_path: Path) -> None:
    repo = create(tmp_path / "repo")
    git(repo, "checkout", "--quiet", "--detach")
    assert snapshot(repo).branch is None


def test_snapshot_without_commits(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    git(repo, "init", "--quiet", "--initial-branch=main")
    facts = snapshot(repo)
    assert facts.head is None
    assert facts.branch == "main"
    assert facts.root_commits == ()
    assert facts.remotes == {}


def test_root_commits_include_other_branches(tmp_path: Path) -> None:
    repo = create(tmp_path / "repo")
    main_root = git(repo, "rev-parse", "HEAD")
    git(repo, "checkout", "--quiet", "--orphan", "pages")
    git(repo, "commit", "--quiet", "--allow-empty", "--message", "pages")
    assert snapshot(repo).root_commits == tuple(sorted([main_root, git(repo, "rev-parse", "HEAD")]))


def test_snapshot_of_bare(tmp_path: Path) -> None:
    repo = create(tmp_path / "repo")
    facts = snapshot(clone(repo, tmp_path / "bare.git", bare=True))
    assert facts.bare
    assert facts.head == git(repo, "rev-parse", "HEAD")
    assert facts.remotes == {"origin": str(repo)}


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://github.com/a/b.git", "https://github.com/a/b.git"),
        ("https://token@github.com/a/b", "https://github.com/a/b"),
        ("https://user:pw@host:8443/a/b", "https://host:8443/a/b"),
        ("ssh://git:pw@host/a/b", "ssh://git@host/a/b"),
        ("ssh://git@host/a/b", "ssh://git@host/a/b"),
        ("git@github.com:a/b.git", "git@github.com:a/b.git"),
        ("/srv/git/b", "/srv/git/b"),
    ],
)
def test_without_credentials(url: str, expected: str) -> None:
    assert without_credentials(url) == expected


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://github.com/a/b.git", "github.com/a/b"),
        ("https://GitHub.com/a/b/", "github.com/a/b"),
        ("git@github.com:a/b.git", "github.com/a/b"),
        ("ssh://git@github.com:22/a/b.git", "github.com/a/b"),
        ("github.com:a/b", "github.com/a/b"),
        ("/srv/git/b.git", "/srv/git/b"),
        ("file:///srv/git/b.git", "/srv/git/b"),
    ],
)
def test_normalise_remote(url: str, expected: str) -> None:
    assert normalise_remote(url) == expected


def test_repository_name() -> None:
    assert repository_name("git@github.com:a/hephaistos.git") == "hephaistos"
    assert repository_name("/srv/git/tools/") == "tools"


def test_main_remote() -> None:
    assert main_remote({"fork": "a", "origin": "b"}) == "b"
    assert main_remote({"upstream": "a", "fork": "b"}) == "b"
    assert main_remote({}) is None
