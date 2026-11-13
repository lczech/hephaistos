from datetime import UTC, datetime
from pathlib import Path

import pytest

from hephaistos.core.utils import graph, history, tips
from hephaistos.core.utils.tips import Between
from support import create, git


def _commit(repo: Path, message: str, at: int | None = None) -> str:
    dated = [f"--date=@{at}"] if at is not None else []
    git(repo, "commit", "--quiet", "--allow-empty", "--message", message, *dated)
    return git(repo, "rev-parse", "HEAD")


def _tips(repo: Path, hidden: tuple[str, ...] = ()) -> tips.Tips:
    starts = graph.starts(repo, "local", hidden, history.refs(repo))
    return tips.tips(repo, starts, order="topo")


def _subjects(found: tips.Tips) -> set[str]:
    """The commits kept, by subject: in the order of the walk, which git picks among tips."""
    return {commit.subject for commit in found.commits}


def _counts(found: tips.Tips) -> list[tuple[str, str, int]]:
    """Each line as (subject, subject of the parent it ends in, commits left out), by subject."""
    subject = {commit.hash: commit.subject for commit in found.commits}
    lines = [(subject[line.commit], subject[line.parent], line.count) for line in found.lines]
    return sorted(lines)


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    """main three ahead of where feature left it, feature two ahead; the first commit before."""
    repo = create(tmp_path / "repo", commits=0)
    _commit(repo, "first")
    _commit(repo, "base")
    git(repo, "switch", "--quiet", "--create", "feature")
    _commit(repo, "feature 1")
    _commit(repo, "feature 2")
    git(repo, "switch", "--quiet", "main")
    for number in range(3):
        _commit(repo, f"main {number + 1}")
    return repo


def test_keeps_the_tips_where_they_part_and_the_first_commit(repo: Path) -> None:
    found = _tips(repo)
    assert _subjects(found) == {"main 3", "feature 2", "base", "first"}
    assert _counts(found) == [
        ("base", "first", 0),  # its own parent
        ("feature 2", "base", 1),
        ("main 3", "base", 2),
    ]
    tip = next(commit for commit in found.commits if commit.subject == "main 3")
    assert [ref.name for ref in tip.refs] == ["main"]
    # Newest first, each after its children.
    order = [commit.subject for commit in found.commits]
    assert order.index("base") > max(order.index("main 3"), order.index("feature 2"))
    assert order[-1] == "first"


def test_dates_the_commits_left_out(tmp_path: Path) -> None:
    repo = create(tmp_path / "repo", commits=0)
    _commit(repo, "first", at=1_700_001_000)
    _commit(repo, "older", at=1_700_002_000)
    _commit(repo, "newer", at=1_700_003_000)
    _commit(repo, "tip", at=1_700_004_000)
    [line] = _tips(repo).lines
    assert (line.count, line.newest, line.oldest) == (
        2,
        datetime.fromtimestamp(1_700_003_000, UTC),
        datetime.fromtimestamp(1_700_002_000, UTC),
    )


def test_counts_a_branch_merged_and_gone_in_the_line_it_was_merged_into(repo: Path) -> None:
    git(repo, "switch", "--quiet", "--create", "topic", "main")
    _commit(repo, "topic 1")
    _commit(repo, "topic 2")
    git(repo, "switch", "--quiet", "main")
    git(repo, "merge", "--quiet", "--no-ff", "--message", "merge topic", "topic")
    git(repo, "branch", "--quiet", "--delete", "topic")
    found = _tips(repo)
    assert _subjects(found) == {"merge topic", "feature 2", "base", "first"}
    # The three of main, the two of topic: what the merge has and base has not.
    assert ("merge topic", "base", 5) in _counts(found)


def test_draws_a_branch_still_there_merged_and_where_it_went_on(repo: Path) -> None:
    git(repo, "merge", "--quiet", "--no-ff", "--message", "merge feature", "feature")
    git(repo, "switch", "--quiet", "feature")
    _commit(repo, "feature 3")
    found = _tips(repo)
    assert _subjects(found) == {"feature 3", "merge feature", "feature 2", "base", "first"}
    assert _counts(found) == [
        ("base", "first", 0),
        ("feature 2", "base", 1),
        ("feature 3", "feature 2", 0),
        ("merge feature", "base", 3),  # the three of main
        ("merge feature", "feature 2", 0),  # its side, where feature was then
    ]


def test_draws_the_default_branch_merged_into_another(repo: Path) -> None:
    git(repo, "switch", "--quiet", "feature")
    git(repo, "merge", "--quiet", "--no-ff", "--message", "merge main", "main")
    found = _tips(repo)
    assert _subjects(found) == {"merge main", "main 3", "base", "first"}
    assert ("merge main", "main 3", 0) in _counts(found)


def test_keeps_detached_heads_and_no_hidden_branches(repo: Path, tmp_path: Path) -> None:
    feature_1 = git(repo, "rev-parse", "feature~")
    git(repo, "worktree", "add", "--quiet", "--detach", str(tmp_path / "loose"), feature_1)
    found = _tips(repo, hidden=("feature",))
    assert _subjects(found) == {"main 3", "feature 1", "base", "first"}


def test_keeps_commits_asked_for_where_the_walk_has_them(repo: Path) -> None:
    feature_2 = git(repo, "rev-parse", "feature")
    git(repo, "merge", "--quiet", "--no-ff", "--message", "merge feature", "feature")
    starts = graph.starts(repo, "local", ("feature",), history.refs(repo))
    assert "feature 2" not in _subjects(tips.tips(repo, starts, order="topo"))
    found = tips.tips(repo, starts, order="topo", keep=[feature_2])
    assert _subjects(found) == {"merge feature", "feature 2", "base", "first"}
    assert ("merge feature", "feature 2", 0) in _counts(found)  # its side drawn, as walked from
    git(repo, "switch", "--quiet", "--create", "aside", "feature~2")
    aside = _commit(repo, "aside")
    git(repo, "switch", "--quiet", "main")
    elsewhere = tips.tips(repo, starts, order="topo", keep=[aside])
    assert "aside" not in _subjects(elsewhere)  # not on the walk: not walked to for it


def test_keeps_nothing_without_starts(repo: Path) -> None:
    assert tips.tips(repo, [], order="topo") == tips.Tips((), ())


def test_counts_each_side_of_a_criss_cross_apart(tmp_path: Path) -> None:
    """Two branches merging each other: each line counts what its newer end has alone."""
    repo = create(tmp_path / "repo", commits=0)
    _commit(repo, "first")
    git(repo, "branch", "other")
    _commit(repo, "main 1")
    git(repo, "switch", "--quiet", "other")
    _commit(repo, "other 1")
    git(repo, "merge", "--quiet", "--no-ff", "--message", "other takes main", "main")
    git(repo, "switch", "--quiet", "main")
    git(repo, "merge", "--quiet", "--no-ff", "--message", "main takes other", "other~")
    found = _tips(repo)
    assert set(_counts(found)) >= {
        ("main takes other", "main 1", 0),
        ("main takes other", "other 1", 0),
        ("other takes main", "other 1", 0),
        ("other takes main", "main 1", 0),
    }
    assert all(isinstance(line, Between) for line in found.lines)


def test_reads_commits_in_the_order_asked(repo: Path) -> None:
    known = history.refs(repo)
    hashes = [git(repo, "rev-parse", name) for name in ("main~3", "feature", "main")]
    assert [commit.hash for commit in history.commits(repo, hashes, known)] == hashes
    assert history.commits(repo, [], known) == []
