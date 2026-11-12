import shutil
from pathlib import Path

import pytest

from hephaistos.core.utils import graph
from hephaistos.core.utils.graph import Head, Standing
from hephaistos.core.utils.history import Next, history, refs
from support import clone, create, git


def _commit(repo: Path, message: str) -> str:
    git(repo, "commit", "--quiet", "--allow-empty", "--message", message)
    return git(repo, "rev-parse", "HEAD")


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    """main, two commits ahead of where feature and old left it; feature one ahead of that."""
    repo = create(tmp_path / "repo", commits=1)
    git(repo, "branch", "old")
    git(repo, "switch", "--quiet", "--create", "feature")
    _commit(repo, "on feature")
    git(repo, "switch", "--quiet", "main")
    _commit(repo, "main 1")
    _commit(repo, "main 2")
    return repo


def test_heads_of_the_main_working_tree_and_its_worktrees(repo: Path, tmp_path: Path) -> None:
    git(repo, "worktree", "add", "--quiet", str(tmp_path / "wt"), "feature")
    git(repo, "worktree", "add", "--quiet", "--detach", str(tmp_path / "loose"), "main~1")
    git(repo, "worktree", "add", "--quiet", str(tmp_path / "gone"), "old")
    shutil.rmtree(tmp_path / "gone")  # prunable: its directory is gone
    found = graph.heads(repo)
    assert found[0] == Head(repo, git(repo, "rev-parse", "main"), "main", main=True)
    assert set(found[1:]) == {  # in the order git lists them
        Head(tmp_path / "wt", git(repo, "rev-parse", "feature"), "feature", main=False),
        Head(tmp_path / "loose", git(repo, "rev-parse", "main~1"), None, main=False),
    }
    assert graph.heads(tmp_path / "wt") == found  # the same from any of them


def test_no_main_working_tree_in_a_bare_clone(repo: Path, tmp_path: Path) -> None:
    bare = clone(repo, tmp_path / "bare.git", bare=True)
    assert graph.heads(bare) == ()


def test_heads_before_the_first_commit(tmp_path: Path) -> None:
    empty = create(tmp_path / "empty", commits=0)
    assert graph.heads(empty) == (Head(empty, None, "main", main=True),)


def test_the_default_branch_as_origin_names_it_then_as_git_would(
    repo: Path, tmp_path: Path
) -> None:
    assert graph.default_branch(repo, refs(repo)) == "main"
    git(repo, "branch", "--move", "main", "master")
    assert graph.default_branch(repo, refs(repo)) == "master"
    git(repo, "config", "init.defaultBranch", "feature")
    assert graph.default_branch(repo, refs(repo)) == "feature"
    copy = clone(repo, tmp_path / "copy")  # origin/HEAD names what HEAD was there: master
    git(copy, "branch", "--quiet", "feature", "origin/feature")
    git(copy, "config", "init.defaultBranch", "feature")
    assert graph.default_branch(copy, refs(copy)) == "master"
    git(copy, "remote", "set-head", "origin", "old")  # a branch not here: the next rule
    assert graph.default_branch(copy, refs(copy)) == "feature"
    git(repo, "branch", "--move", "master", "trunk")
    git(repo, "config", "--unset", "init.defaultBranch")
    assert graph.default_branch(repo, refs(repo)) is None


def test_branches_ahead_and_behind_the_default_branch(repo: Path) -> None:
    found = graph.standings(repo, "main", refs(repo))
    assert found == {"feature": Standing(1, 2, "main"), "old": Standing(0, 2, "main")}
    assert graph.standings(repo, None, refs(repo)) == {}


def test_counted_one_by_one_where_git_cannot_at_once(
    repo: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    at_once = graph.standings(repo, "main", refs(repo))

    def cannot(_top: Path, _default: str) -> None:  # as git before 2.41
        return None

    monkeypatch.setattr(graph, "_ahead_behind", cannot)
    assert graph.standings(repo, "main", refs(repo)) == at_once


def test_counts_by_branches_where_tags_have_their_names(
    repo: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # A tag named as a branch, elsewhere: git takes a bare name for the tag.
    git(repo, "tag", "feature", "main")
    git(repo, "tag", "main", "old")

    def cannot(_top: Path, _default: str) -> None:  # as git before 2.41
        return None

    monkeypatch.setattr(graph, "_ahead_behind", cannot)
    found = graph.standings(repo, "main", refs(repo))
    assert found == {"feature": Standing(1, 2, "main"), "old": Standing(0, 2, "main")}


def test_the_default_branch_against_its_upstream(repo: Path, tmp_path: Path) -> None:
    copy = clone(repo, tmp_path / "copy")
    _commit(copy, "not pushed")
    git(repo, "commit", "--quiet", "--allow-empty", "--message", "not fetched")
    git(copy, "fetch", "--quiet")
    found = graph.standings(copy, "main", refs(copy))
    assert found["main"] == Standing(1, 1, "origin/main")


def test_walks_start_from_all_local_branches_and_detached_heads(repo: Path, tmp_path: Path) -> None:
    git(repo, "worktree", "add", "--quiet", "--detach", str(tmp_path / "loose"), "main~1")
    aside = _commit(tmp_path / "loose", "only in the detached worktree")
    # The branches as git lists them, the most recent first: those made in a second in any order.
    *branches, last = graph.starts(repo, "local", (), refs(repo))
    assert (sorted(branches), last) == (
        ["refs/heads/feature", "refs/heads/main", "refs/heads/old"],
        aside,
    )
    *branches, last = graph.starts(repo, "local", ("old", "gone"), refs(repo))
    assert (sorted(branches), last) == (["refs/heads/feature", "refs/heads/main"], aside)
    walked = history(repo, starts=graph.starts(repo, "local", (), refs(repo)), limit=100)
    assert aside in {commit.hash for commit in walked.commits}  # which --branches would miss


def test_walks_of_worktrees_start_from_their_branches_and_the_default_one(
    repo: Path, tmp_path: Path
) -> None:
    git(repo, "worktree", "add", "--quiet", str(tmp_path / "wt"), "feature")
    git(repo, "switch", "--quiet", "--create", "topic")  # the main working tree on topic
    assert graph.starts(repo, "worktrees", (), refs(repo)) == [
        "refs/heads/feature",
        "refs/heads/main",
        "refs/heads/topic",
    ]  # not old, in no Checkout
    assert graph.starts(repo, "worktrees", ("feature",), refs(repo)) == [
        "refs/heads/main",
        "refs/heads/topic",
    ]


def test_a_walk_from_nothing_has_no_commits(repo: Path) -> None:
    found = history(repo, starts=[], limit=10)
    assert (found.commits, found.next) == ((), None)
    # Nor on a later page, rather than walking from HEAD.
    later = history(repo, starts=[], after=Next(None, None, 1), limit=10)
    assert (later.commits, later.next) == ((), None)


def test_walks_before_the_first_commit_have_no_commits(repo: Path, tmp_path: Path) -> None:
    empty = create(tmp_path / "empty", commits=0)
    for branches in ("local", "worktrees"):
        starts = graph.starts(empty, branches, (), refs(empty))
        assert starts == []
        assert history(empty, starts=starts, limit=10).commits == ()
    # An orphan Worktree, its branch without commits yet: walked from the others.
    git(repo, "worktree", "add", "--quiet", "--orphan", "-b", "fresh", str(tmp_path / "fresh"))
    assert graph.starts(repo, "worktrees", (), refs(repo)) == ["refs/heads/main"]


def test_a_walk_from_starts_goes_on_in_pages(repo: Path) -> None:
    starts = graph.starts(repo, "local", (), refs(repo))
    whole = history(repo, starts=starts, order="topo", limit=100).commits
    first = history(repo, starts=starts, order="topo", limit=2)
    assert first.next is not None
    assert first.next.start is None
    rest = history(repo, starts=starts, order="topo", after=first.next, limit=100)
    assert (*first.commits, *rest.commits) == whole
