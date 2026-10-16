import subprocess
from pathlib import Path

import pytest

from hephaistos.core.utils.changes import (
    FOLDER_FILES,
    Change,
    Changes,
    ChangesError,
    changes,
    diff_arguments,
)
from support import create, git


def _changes(
    repo: Path,
    base: str | None = None,
    target: str | None = None,
    *,
    path: str | None = None,
    max_files: int = 100,
) -> Changes:
    """The changes, with room for all and untracked files up to 1000 bytes counted."""
    return changes(repo, base, target, path=path, max_files=max_files, max_bytes=1000)


def _write(repo: Path, path: str, text: str | bytes) -> None:
    file = repo / path
    file.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(text, bytes):
        file.write_bytes(text)
    else:
        file.write_text(text)


def _commit(repo: Path, files: dict[str, str | bytes]) -> None:
    for path, text in files.items():
        _write(repo, path, text)
    git(repo, "add", "--all")
    git(repo, "commit", "--quiet", "--message", "files")


def _groups(found: Changes) -> dict[str, list[Change]]:
    return {group.name: list(group.changes) for group in found.groups}


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    repo = create(tmp_path / "repo")
    _commit(
        repo, {"a.txt": "one\ntwo\n", "b.txt": "b\n", "gone.txt": "x\n", "old.txt": "same\n" * 5}
    )
    return repo


def test_groups_as_git_status(repo: Path) -> None:
    _write(repo, "a.txt", "one\n2\nthree\n")
    git(repo, "add", "a.txt")
    _write(repo, "a.txt", "one\n2\nthree\nfour\n")  # staged, then changed again
    _write(repo, "b.txt", "B\n")
    (repo / "gone.txt").unlink()
    git(repo, "mv", "old.txt", "new.txt")
    _write(repo, "notes.md", "a\nb\nc")  # no newline at the end
    found = _changes(repo)
    assert found.status is not None
    assert found.status.branch == "main"
    assert [(group.name, group.base, group.target) for group in found.groups] == [
        ("staged", "HEAD", "index"),
        ("unstaged", "index", "worktree"),
        ("untracked", "index", "worktree"),
    ]
    assert _groups(found) == {
        "staged": [
            Change("a.txt", "M", added=2, removed=1),
            Change("new.txt", "R", original="old.txt", added=0, removed=0),
        ],
        "unstaged": [
            Change("a.txt", "M", added=1, removed=0),
            Change("b.txt", "M", added=1, removed=1),
            Change("gone.txt", "D", added=0, removed=1),
        ],
        "untracked": [Change("notes.md", "?", added=3, removed=0)],
    }


def test_nothing_changed(repo: Path) -> None:
    assert _changes(repo).groups == ()


def test_binary_files_have_sizes(repo: Path) -> None:
    _commit(repo, {"image.bin": b"\0" * 10, "removed.bin": b"\0" * 7})
    _write(repo, "image.bin", b"\0" * 25)
    git(repo, "add", "image.bin")
    _write(repo, "image.bin", b"\0" * 30)
    (repo / "removed.bin").unlink()
    _write(repo, "new.bin", b"x\0y")
    groups = _groups(_changes(repo))
    assert groups["staged"] == [Change("image.bin", "M", binary=True, size=25, old_size=10)]
    assert groups["unstaged"] == [
        Change("image.bin", "M", binary=True, size=30, old_size=25),
        Change("removed.bin", "D", binary=True, old_size=7),
    ]
    assert groups["untracked"] == [Change("new.bin", "?", binary=True, size=3)]


def test_large_untracked_files_are_not_counted(repo: Path) -> None:
    _write(repo, "big.txt", "x\n" * 600)
    assert _groups(_changes(repo))["untracked"] == [Change("big.txt", "?", size=1200)]


def test_new_folders_count_their_files(repo: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _write(repo, "new/one.txt", "1\n")
    _write(repo, "new/deeper/two.txt", "22\n")
    _write(repo, "new/ignored.log", "x")
    _write(repo, ".gitignore", "*.log\n")
    groups = _groups(_changes(repo))
    assert groups["untracked"] == [
        Change(".gitignore", "?", added=1, removed=0),
        Change("new/", "?", size=5, files=2),
    ]
    inside = _changes(repo, path="new/")
    assert _groups(inside) == {
        "untracked": [
            Change("new/deeper/two.txt", "?", added=1, removed=0),
            Change("new/one.txt", "?", added=1, removed=0),
        ]
    }
    monkeypatch.setattr("hephaistos.core.utils.changes.FOLDER_FILES", 1)
    assert FOLDER_FILES > 1
    [folder] = [change for change in _groups(_changes(repo))["untracked"] if change.files]
    assert (folder.files, folder.more_files) == (1, True)


def test_a_path_limits_the_changes(repo: Path) -> None:
    _write(repo, "a.txt", "changed\n")
    _write(repo, "b.txt", "changed\n")
    found = _changes(repo, path="b.txt")
    assert [change.path for change in _groups(found)["unstaged"]] == ["b.txt"]


def test_paths_are_literal(repo: Path) -> None:
    _write(repo, "a.txt", "changed\n")
    _write(repo, "b.txt", "changed\n")
    assert _changes(repo, path="*.txt").groups == ()


@pytest.mark.parametrize("path", ["/etc", "../x", "a/../../x", ""])
def test_paths_stay_within(repo: Path, path: str) -> None:
    with pytest.raises(ChangesError, match="within the Checkout"):
        _changes(repo, path=path)


def test_unmerged_files(repo: Path) -> None:
    git(repo, "checkout", "--quiet", "-b", "other")
    _commit(repo, {"a.txt": "other\n"})
    git(repo, "checkout", "--quiet", "main")
    _commit(repo, {"a.txt": "mine\n"})
    with pytest.raises(subprocess.CalledProcessError):  # a conflict
        git(repo, "merge", "--quiet", "other")
    found = _changes(repo)
    assert [(group.name, group.base, group.target) for group in found.groups] == [
        ("unmerged", "HEAD", "worktree")
    ]
    [conflict] = _groups(found)["unmerged"]
    assert (conflict.path, conflict.status, conflict.removed) == ("a.txt", "U", 0)
    assert conflict.added == 4  # git's markers and the other side


def test_between_commits(repo: Path) -> None:
    _commit(repo, {"a.txt": "one\n", "c.txt": "c\n"})
    found = _changes(repo, "HEAD~1", "HEAD")
    assert found.status is None
    [group] = found.groups
    assert (group.name, group.base, group.target) == ("changes", "HEAD~1", "HEAD")
    assert list(group.changes) == [
        Change("a.txt", "M", added=0, removed=1),
        Change("c.txt", "A", added=1, removed=0),
    ]
    reverse = _changes(repo, "HEAD", "HEAD~1").groups[0].changes
    assert [(change.path, change.status) for change in reverse] == [("a.txt", "M"), ("c.txt", "D")]


def test_since_head_includes_staged_unstaged_and_untracked(repo: Path) -> None:
    _write(repo, "a.txt", "one\ntwo\nthree\n")
    git(repo, "add", "a.txt")
    _write(repo, "b.txt", "changed\n")
    _write(repo, "new.txt", "new\n")
    found = _changes(repo, "HEAD", "worktree")
    assert found.status is not None
    assert [change.path for change in found.groups[0].changes] == ["a.txt", "b.txt", "new.txt"]


def test_unborn_head_is_empty(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    git(repo, "init", "--quiet")
    _write(repo, "first.txt", "1\n")
    git(repo, "add", "first.txt")
    staged = _groups(_changes(repo))["staged"]
    assert staged == [Change("first.txt", "A", added=1, removed=0)]
    assert _changes(repo, "HEAD", "index").groups[0].changes == tuple(staged)


@pytest.mark.parametrize("state", ["nope", "--output=x", "", "HEAD~5"])
def test_unknown_states(repo: Path, state: str) -> None:
    with pytest.raises(ChangesError, match="neither index, worktree nor a commit"):
        _changes(repo, state, "worktree")
    assert not (repo / "x").exists()


def test_both_states_or_neither(repo: Path) -> None:
    with pytest.raises(ChangesError, match="both"):
        _changes(repo, "HEAD", None)


def test_at_most_max_files_per_group(repo: Path) -> None:
    for name in "cba":
        _write(repo, f"{name}.new", "x\n")
    [group] = _changes(repo, max_files=2).groups
    assert ([change.path for change in group.changes], group.count) == (["a.new", "b.new"], 3)


@pytest.mark.parametrize(
    ("base", "target", "arguments"),
    [
        ("index", "worktree", []),
        ("worktree", "index", ["-R"]),
        ("c1", "index", ["--cached", "c1"]),
        ("index", "c1", ["--cached", "-R", "c1"]),
        ("c1", "worktree", ["c1"]),
        ("worktree", "c1", ["-R", "c1"]),
        ("c1", "c2", ["c1", "c2"]),
        ("c1", "c1", None),
        ("index", "index", None),
    ],
)
def test_diff_arguments(base: str, target: str, arguments: list[str] | None) -> None:
    assert diff_arguments(base, target) == arguments
