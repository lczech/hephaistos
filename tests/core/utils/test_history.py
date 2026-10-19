from pathlib import Path

import pytest

from hephaistos.core.utils import git as git_facts
from hephaistos.core.utils.changes import ChangesError, changes, commit_revisions
from hephaistos.core.utils.history import (
    History,
    HistoryError,
    Next,
    Ref,
    by_hash,
    commit,
    history,
    refs,
)
from support import clone, create, git


def _commit(repo: Path, message: str, files: dict[str, str] | None = None) -> str:
    for path, text in (files or {}).items():
        (repo / path).write_text(text)
    git(repo, "add", "--all")
    git(repo, "commit", "--quiet", "--allow-empty", "--message", message)
    return git(repo, "rev-parse", "HEAD")


def _subjects(repo: Path, ref: str | None = None, path: str | None = None) -> list[str]:
    return [commit.subject for commit in history(repo, ref, path, limit=100).commits]


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    repo = create(tmp_path / "repo", commits=0)
    _commit(repo, "one", {"a.txt": "a\n"})
    _commit(repo, "two", {"b.txt": "b\n"})
    _commit(repo, "three", {"a.txt": "a\nmore\n"})
    return repo


def test_commits_newest_first_with_their_refs(repo: Path) -> None:
    git(repo, "tag", "--annotate", "--message", "first", "v1", "HEAD~2")
    git(repo, "commit", "--quiet", "--allow-empty", "--message", "four", "--message", "Why.")
    found = history(repo, limit=10)
    assert [commit.subject for commit in found.commits] == ["four", "three", "two", "one"]
    newest, *_, oldest = found.commits
    assert (newest.body, newest.author.name, newest.parents) == (
        "Why.",
        git(repo, "log", "-1", "--format=%aN"),
        (found.commits[1].hash,),
    )
    assert newest.refs == (Ref("main", "branch", newest.hash),)
    assert oldest.refs == (Ref("v1", "tag", oldest.hash),)  # peeled to its commit
    assert (oldest.parents, found.next) == ((), None)


def test_pages_go_on_from_where_they_ended(repo: Path) -> None:
    first = history(repo, limit=2)
    assert [commit.subject for commit in first.commits] == ["three", "two"]
    assert first.next is not None
    _commit(repo, "newer")  # a page goes on from its start, not from HEAD now
    rest = history(repo, after=first.next, limit=2)
    assert ([commit.subject for commit in rest.commits], rest.next) == (["one"], None)


def test_from_a_ref(repo: Path) -> None:
    git(repo, "switch", "--quiet", "--create", "side", "HEAD~1")
    _commit(repo, "aside")
    assert _subjects(repo) == ["aside", "two", "one"]
    assert _subjects(repo, ref="main") == ["three", "two", "one"]
    with pytest.raises(HistoryError, match="'gone' is not a branch, tag or commit here"):
        history(repo, "gone", limit=10)


def test_no_commits_yet(tmp_path: Path) -> None:
    repo = create(tmp_path / "empty", commits=0)
    assert history(repo, limit=10) == History((), None)
    assert refs(repo).head is None


def test_a_path_and_its_renames(repo: Path) -> None:
    git(repo, "mv", "a.txt", "c.txt")
    _commit(repo, "renamed")
    _commit(repo, "edited", {"c.txt": "a\nmore\nand more\n"})
    assert _subjects(repo, path="b.txt") == ["two"]
    found = history(repo, path="c.txt", limit=100)
    assert [(commit.subject, commit.renamed_from) for commit in found.commits] == [
        ("edited", None),
        ("renamed", "a.txt"),
        ("three", None),
        ("one", None),
    ]
    # Pages break anywhere: also right at the rename.
    page = history(repo, path="c.txt", limit=2)
    assert page.next == Next(found.commits[1].parents[0], "a.txt", 0)
    rest = history(repo, path="c.txt", after=page.next, limit=2)
    assert [commit.subject for commit in rest.commits] == ["three", "one"]
    with pytest.raises(ChangesError, match="must lie within the Checkout"):
        history(repo, path="../outside", limit=10)


def test_a_search_keeps_messages_with_all_its_words(repo: Path) -> None:
    _commit(repo, "Mark rows whose View is shown")
    _commit(repo, "Fix the row height")
    git(repo, "commit", "--quiet", "--allow-empty", "-m", "Tabs", "-m", "Rows of each view.")
    _commit(repo, "a.c")

    def found(search: str, limit: int = 100) -> list[str]:
        return [commit.subject for commit in history(repo, search=search, limit=limit).commits]

    assert found("row view") == ["Tabs", "Mark rows whose View is shown"]  # also in a body
    assert found("VIEW rows") == found("row view")
    assert found("a.c") == ["a.c"]  # as typed, not a pattern
    assert found("  ") == found("")
    assert len(found("")) == 7
    # Pages go on through those kept.
    first = history(repo, search="row", limit=2)
    rest = history(repo, search="row", after=first.next, limit=2)
    assert [commit.subject for commit in first.commits + rest.commits] == [
        "Tabs",
        "Fix the row height",
        "Mark rows whose View is shown",
    ]
    assert rest.next is None


def test_a_search_follows_renames_it_leaves_out(repo: Path) -> None:
    git(repo, "mv", "a.txt", "c.txt")
    _commit(repo, "renamed")
    found = history(repo, path="c.txt", search="one", limit=100)
    assert [commit.subject for commit in found.commits] == ["one"]


def test_everywhere_walks_all_branches_and_tags(repo: Path) -> None:
    git(repo, "switch", "--quiet", "--create", "side", "HEAD~1")
    _commit(repo, "aside")
    git(repo, "switch", "--quiet", "--detach", "HEAD~1")
    _commit(repo, "detached")
    found = history(repo, everywhere=True, limit=100)
    assert sorted(commit.subject for commit in found.commits) == [
        "aside",
        "detached",
        "one",
        "three",
        "two",
    ]
    first = history(repo, everywhere=True, search="a", limit=1)  # aside, detached
    assert first.next == Next(None, None, 1)
    rest = history(repo, everywhere=True, search="a", after=first.next, limit=10)
    assert {commit.subject for commit in first.commits + rest.commits} == {"aside", "detached"}
    with pytest.raises(HistoryError, match="give a ref or everywhere, not both"):
        history(repo, "main", everywhere=True, limit=10)
    assert history(create(repo.parent / "empty", commits=0), everywhere=True, limit=10) == History(
        (), None
    )


def test_a_hash_and_where_its_commit_is(repo: Path) -> None:
    one, two, three = (git(repo, "rev-parse", f"HEAD~{n}") for n in (2, 1, 0))
    git(repo, "switch", "--quiet", "--create", "side", two)
    aside = _commit(repo, "aside")
    git(repo, "tag", "v2", aside)
    git(repo, "switch", "--quiet", "main")
    git(repo, "commit", "--quiet", "--amend", "--message", "three, amended")

    def where(
        search: str, ref: str | None = None, path: str | None = None, *, everywhere: bool = False
    ) -> tuple[str, str, tuple[str, ...]] | None:
        found = by_hash(repo, search, ref, path, everywhere=everywhere)
        if found is None:
            return None
        return found.commit.hash, found.where, tuple(ref.name for ref in found.refs)

    assert where(two[:7]) == (two, "listed", ())
    assert where(f" {two.upper()} ") == (two, "listed", ())
    assert where(one[:7], path="b.txt") == (one, "path", ())
    assert where(aside[:7]) == (aside, "refs", ("side", "v2"))
    assert where(aside[:7], ref="side") == (aside, "listed", ())
    assert where(aside[:7], everywhere=True) == (aside, "listed", ())
    assert where(three[:7]) == (three, "none", ())
    assert where(three[:7], everywhere=True) == (three, "none", ())
    for search in ("two", "abc", f"{two[:7]} two", "0000000", ""):
        assert where(search) is None


def test_refs_of_a_clone(repo: Path, tmp_path: Path) -> None:
    copy = clone(repo, tmp_path / "copy")
    git(copy, "switch", "--quiet", "--create", "feature")
    git(copy, "tag", "light")
    found = refs(copy)
    head = git(copy, "rev-parse", "HEAD")
    assert (found.head, found.branch) == (head, "feature")
    names = [(ref.kind, ref.name) for ref in found.refs]  # without `origin/HEAD`
    assert sorted(names) == [
        ("branch", "feature"),
        ("branch", "main"),
        ("remote", "origin/main"),
        ("tag", "light"),
    ]
    assert [kind for kind, _ in names] == ["branch", "branch", "remote", "tag"]
    git(copy, "switch", "--quiet", "--detach")
    assert refs(copy).branch is None


def test_a_commit_and_whether_anything_leads_to_it(repo: Path) -> None:
    head = git(repo, "rev-parse", "HEAD")
    shown = commit(repo, "HEAD~1")
    assert (shown.commit and shown.commit.subject, shown.reachable) == ("two", True)
    git(repo, "commit", "--quiet", "--amend", "--message", "three, better")
    amended = commit(repo, head)  # the reflog keeps it
    assert (amended.commit and amended.commit.subject, amended.reachable) == ("three", False)
    assert commit(repo, "0" * 40) == commit(repo, "nothing")
    assert commit(repo, "nothing").commit is None


def test_a_commits_changes_against_its_first_parent(repo: Path) -> None:
    root = git(repo, "rev-list", "--max-parents=0", "HEAD")
    base, target = commit_revisions(repo, root)  # against the empty tree
    found = changes(repo, base, target, max_files=10, max_bytes=1000)
    assert [change.path for change in found.groups[0].changes] == ["a.txt"]
    git(repo, "switch", "--quiet", "--create", "side", "HEAD~1")
    _commit(repo, "aside", {"d.txt": "d\n"})
    git(repo, "switch", "--quiet", "main")
    git(repo, "merge", "--quiet", "--no-edit", "side")
    merge = git(repo, "rev-parse", "HEAD")
    assert commit_revisions(repo, merge) == (git(repo, "rev-parse", "HEAD^1"), merge)
    found = changes(repo, *commit_revisions(repo, merge), max_files=10, max_bytes=1000)
    assert [change.path for change in found.groups[0].changes] == ["d.txt"]
    with pytest.raises(ChangesError, match="'nothing' is not a commit here"):
        commit_revisions(repo, "nothing")


def test_bodies_of_commits_git_still_has(repo: Path) -> None:
    git(repo, "commit", "--quiet", "--allow-empty", "--message", "four", "--message", "Body.")
    head = git(repo, "rev-parse", "HEAD")
    parent = git(repo, "rev-parse", "HEAD~1")
    assert git_facts.bodies(repo, [head, parent, "1" * 40]) == {head: "Body.", parent: ""}
    assert git_facts.bodies(repo, []) == {}
