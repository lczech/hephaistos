from pathlib import Path

import pytest

from hephaistos.core.utils.git import (
    Entry,
    GitError,
    GitTimeoutError,
    LinkedWorktree,
    NotInRepositoryError,
    branches,
    locate,
    main_remote,
    normalise_remote,
    parse_status,
    repository_name,
    shares_history,
    snapshot,
    status,
    without_credentials,
    worktrees,
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


STATUS_FIELDS = (
    "# branch.oid 1234",
    "# branch.head main",
    "# branch.upstream origin/main",
    "# branch.ab +2 -1",
    "1 .M N... 100644 100644 100644 abc abc a file.txt",
    "1 A. N... 000000 100644 100644 000 def new.txt",
    "1 MM N... 100644 100644 100644 abc def both.txt",
    "2 R. N... 100644 100644 100644 abc abc R100 new name.txt",
    "old name.txt",
    "u UU N... 100644 100644 100644 100644 a b c conflict.txt",
    "? untracked dir/",
    "",
)


def test_parse_status() -> None:
    parsed = parse_status("\0".join(STATUS_FIELDS))
    assert (parsed.upstream, parsed.ahead, parsed.behind) == ("origin/main", 2, 1)
    assert parsed.entries == (
        Entry("a file.txt", ".", "M"),
        Entry("new.txt", "A", "."),
        Entry("both.txt", "M", "M"),
        Entry("new name.txt", "R", ".", original="old name.txt"),
        Entry("conflict.txt", "U", "U", conflicted=True),
        Entry("untracked dir/", "?", "?"),
    )
    counts = (parsed.staged, parsed.changed, parsed.untracked, parsed.conflicted)
    assert counts == (3, 2, 1, 1)


def test_parse_status_without_upstream() -> None:
    parsed = parse_status("# branch.oid (initial)\0# branch.head main\0")
    assert (parsed.upstream, parsed.ahead, parsed.behind, parsed.entries) == (None, None, None, ())


def test_status(tmp_path: Path) -> None:
    origin = create(tmp_path / "origin")
    repo = clone(origin, tmp_path / "repo")
    git(repo, "commit", "--quiet", "--allow-empty", "--message", "ahead")
    (repo / "staged file").write_text("x")
    git(repo, "add", "staged file")
    (repo / "dir").mkdir()
    (repo / "dir" / "a").write_text("a")
    (repo / "dir" / "b").write_text("b")
    found = status(repo)
    assert (found.upstream, found.ahead, found.behind) == ("origin/main", 1, 0)
    assert (found.staged, found.changed, found.untracked, found.conflicted) == (1, 0, 1, 0)


def test_branches(tmp_path: Path) -> None:
    repo = create(tmp_path / "repo")
    git(repo, "branch", "feature/x")
    assert branches(repo) == ("feature/x", "main")


def test_timeout(tmp_path: Path) -> None:
    repo = create(tmp_path / "repo")
    with pytest.raises(GitTimeoutError, match="timed out"):
        status(repo, timeout=1e-6)


def test_not_in_repository(tmp_path: Path) -> None:
    with pytest.raises(NotInRepositoryError):
        locate(tmp_path)


def test_snapshot_status_and_branches(tmp_path: Path) -> None:
    repo = create(tmp_path / "repo")
    (repo / "new").write_text("x")
    facts = snapshot(repo)
    assert facts.branches == ("main",)
    assert facts.status is not None
    assert facts.status.untracked == 1
    assert snapshot(clone(repo, tmp_path / "bare.git", bare=True)).status is None


@pytest.mark.parametrize(
    ("roots", "known", "expected"),
    [(["a"], ["a", "b"], True), (["a"], ["b"], False), ([], ["b"], True), (["a"], [], True)],
)
def test_shares_history(roots: list[str], known: list[str], *, expected: bool) -> None:
    assert shares_history(roots, known) is expected


def test_worktrees(tmp_path: Path) -> None:
    repo = create(tmp_path / "repo")
    head = git(repo, "rev-parse", "HEAD")
    git(repo, "worktree", "add", "--quiet", "-b", "feature", str(repo / ".worktrees" / "feature"))
    git(repo, "worktree", "add", "--quiet", "--detach", str(tmp_path / "detached"))
    git(repo, "worktree", "add", "--quiet", "-b", "usb", str(tmp_path / "usb"))
    git(repo, "worktree", "lock", "--reason", "on a stick", str(tmp_path / "usb"))
    git(repo, "worktree", "add", "--quiet", "-b", "gone", str(tmp_path / "gone"))
    git(repo, "worktree", "lock", str(tmp_path / "gone"))
    git(repo, "worktree", "add", "--quiet", "-b", "moved", str(tmp_path / "before"))
    git(repo, "worktree", "move", str(tmp_path / "before"), str(tmp_path / "after"))
    (tmp_path / "gone").rename(tmp_path / "elsewhere")

    location = locate(repo)
    assert location.common_dir == (repo / ".git").resolve()
    listed = sorted(worktrees(repo, location.common_dir), key=lambda linked: linked.name)
    assert listed == [
        LinkedWorktree("before", tmp_path / "after", head, "moved", None),
        LinkedWorktree("detached", tmp_path / "detached", head, None, None),
        LinkedWorktree("feature", repo / ".worktrees" / "feature", head, "feature", None),
        LinkedWorktree("gone", tmp_path / "gone", head, "gone", ""),
        LinkedWorktree("usb", tmp_path / "usb", head, "usb", "on a stick"),
    ]


def test_worktrees_of_bare(tmp_path: Path) -> None:
    bare = clone(create(tmp_path / "repo"), tmp_path / "bare.git", bare=True)
    git(bare, "worktree", "add", "--quiet", str(tmp_path / "main"), "main")
    location = locate(bare)
    assert location.common_dir == bare.resolve()
    [linked] = worktrees(bare, location.common_dir)
    assert (linked.name, linked.branch) == ("main", "main")


def test_locate_worktree_common_dir(tmp_path: Path) -> None:
    repo = create(tmp_path / "repo")
    git(repo, "worktree", "add", "--quiet", "-b", "x", str(tmp_path / "wt"))
    assert locate(tmp_path / "wt").common_dir == (repo / ".git").resolve()
