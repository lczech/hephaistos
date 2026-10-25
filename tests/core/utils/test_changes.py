import subprocess
import tracemalloc
from pathlib import Path

import pytest

from hephaistos.core.utils.changes import (
    FOLDER_FILES,
    Change,
    Changes,
    ChangesError,
    Diffs,
    Versions,
    changes,
    diff,
    diff_arguments,
    diffs,
    versions,
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
        ("unstaged", "index", "working-tree"),
        ("untracked", "index", "working-tree"),
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
    with pytest.raises(ChangesError, match="within the checkout"):
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
        ("unmerged", "HEAD", "working-tree")
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
    found = _changes(repo, "HEAD", "working-tree")
    assert found.status is not None
    assert [change.path for change in found.groups[0].changes] == ["a.txt", "b.txt", "new.txt"]


def test_from_the_working_tree_untracked_files_are_deleted(repo: Path) -> None:
    _write(repo, "new.txt", "one\ntwo\n")
    _write(repo, "folder/inside.txt", "x\n")
    [forward] = _changes(repo, "HEAD", "working-tree").groups
    [backward] = _changes(repo, "working-tree", "HEAD").groups
    assert [(change.path, change.status) for change in forward.changes] == [
        ("folder/", "?"),
        ("new.txt", "?"),
    ]
    assert [(change.path, change.status) for change in backward.changes] == [
        ("folder/", "D"),
        ("new.txt", "D"),
    ]
    assert backward.changes[1] == Change("new.txt", "D", added=0, removed=2)
    assert [group.changes for group in _changes(repo, "working-tree", "index").groups] == [
        backward.changes
    ]


def test_unborn_head_is_empty(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    git(repo, "init", "--quiet")
    _write(repo, "first.txt", "1\n")
    git(repo, "add", "first.txt")
    staged = _groups(_changes(repo))["staged"]
    assert staged == [Change("first.txt", "A", added=1, removed=0)]
    assert _changes(repo, "HEAD", "index").groups[0].changes == tuple(staged)


@pytest.mark.parametrize("revision", ["nope", "--output=x", "", "HEAD~5"])
def test_unknown_revisions(repo: Path, revision: str) -> None:
    with pytest.raises(ChangesError, match="neither index, working-tree nor a commit"):
        _changes(repo, revision, "working-tree")
    assert not (repo / "x").exists()


def test_both_states_or_neither(repo: Path) -> None:
    with pytest.raises(ChangesError, match="both"):
        _changes(repo, "HEAD", None)


def test_at_most_max_files_per_group(repo: Path) -> None:
    for name in "cba":
        _write(repo, f"{name}.new", "x\n")
    [group] = _changes(repo, max_files=2).groups
    assert ([change.path for change in group.changes], group.count) == (["a.new", "b.new"], 3)


def test_untracked_files_beyond_the_limit_are_not_read(
    repo: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    for number in range(20):
        _write(repo, f"new{number:02}.txt", "x\n")
    read: list[str] = []
    real = Path.read_bytes

    def spied(self: Path) -> bytes:
        read.append(self.name)
        return real(self)

    monkeypatch.setattr(Path, "read_bytes", spied)
    [group] = _changes(repo, max_files=2).groups
    assert (group.count, [change.added for change in group.changes]) == (20, [1, 1])
    assert read == ["new00.txt", "new01.txt"]
    read.clear()
    _write(repo, "a.txt", "changed\n")  # sorts first, among the untracked files
    [group] = _changes(repo, "HEAD", "working-tree", max_files=2).groups
    assert [change.path for change in group.changes] == ["a.txt", "new00.txt"]
    assert read == ["new00.txt"]


@pytest.mark.parametrize(
    ("base", "target", "arguments"),
    [
        ("index", "working-tree", []),
        ("working-tree", "index", ["-R"]),
        ("c1", "index", ["--cached", "c1"]),
        ("index", "c1", ["--cached", "-R", "c1"]),
        ("c1", "working-tree", ["c1"]),
        ("working-tree", "c1", ["-R", "c1"]),
        ("c1", "c2", ["c1", "c2"]),
        ("c1", "c1", None),
        ("index", "index", None),
    ],
)
def test_diff_arguments(base: str, target: str, arguments: list[str] | None) -> None:
    assert diff_arguments(base, target) == arguments


# One file: its patch, and both its versions


def _patch_lines(patch: str | None) -> list[str]:
    """A patch's lines from its first hunk on, without git's headers."""
    assert patch is not None
    lines = patch.splitlines()
    return lines[next(i for i, line in enumerate(lines) if line.startswith("@@")) :]


def test_diff_of_a_file(repo: Path) -> None:
    _write(repo, "a.txt", "one\n2\n")
    found = diff(repo, "index", "working-tree", "a.txt", max_bytes=1000)
    assert found.change == Change("a.txt", "M", added=1, removed=1)
    assert found.patch is not None
    assert found.patch.startswith("diff --git a/a.txt b/a.txt\n")
    assert _patch_lines(found.patch) == ["@@ -1,2 +1,2 @@", " one", "-two", "+2"]
    assert diff(repo, "HEAD", "index", "a.txt", max_bytes=1000).change is None
    assert diff(repo, "HEAD", "HEAD", "a.txt", max_bytes=1000) == diff(
        repo, "index", "working-tree", "b.txt", max_bytes=1000
    )


def test_diff_with_more_or_fewer_lines_around(repo: Path) -> None:
    git(repo, "config", "diff.context", "8")  # the user's, which ours replaces
    lines = [f"{n}\n" for n in range(1, 11)]
    _write(repo, "a.txt", "".join(lines))
    git(repo, "add", "a.txt")
    _write(repo, "a.txt", "".join([*lines[:4], "five\n", *lines[5:]]))
    hunks = [
        _patch_lines(diff(repo, "index", "working-tree", "a.txt", max_bytes=1000, context=n).patch)
        for n in (0, 1, 3)
    ]
    assert [lines[0] for lines in hunks] == ["@@ -5 +5 @@", "@@ -4,3 +4,3 @@", "@@ -2,7 +2,7 @@"]


def test_diff_ignores_the_users_config(repo: Path) -> None:
    git(repo, "config", "diff.noprefix", "true")
    git(repo, "config", "color.ui", "always")
    git(repo, "config", "diff.external", "false")
    _write(repo, "ä.txt", "x\n")
    git(repo, "add", "ä.txt")
    patch = diff(repo, "HEAD", "index", "ä.txt", max_bytes=1000).patch
    assert patch is not None
    assert patch.startswith("diff --git a/ä.txt b/ä.txt\n")
    assert "\x1b" not in patch


def test_diff_of_a_rename_by_either_path(repo: Path) -> None:
    git(repo, "mv", "old.txt", "new.txt")
    _write(repo, "new.txt", "same\n" * 5 + "more\n")
    git(repo, "add", "new.txt")
    renamed = Change("new.txt", "R", original="old.txt", added=1, removed=0)
    for path in ("new.txt", "old.txt"):
        found = diff(repo, "HEAD", "index", path, max_bytes=1000)
        assert found.change == renamed
        assert found.patch is not None
        assert "rename from old.txt\nrename to new.txt\n" in found.patch
    assert versions(repo, "HEAD", "index", "new.txt", max_bytes=1000) == Versions(
        "same\n" * 5, "same\n" * 5 + "more\n"
    )


def test_diff_of_an_untracked_file(repo: Path) -> None:
    _write(repo, "notes.md", "a\nb")
    found = diff(repo, "index", "working-tree", "notes.md", max_bytes=1000)
    assert found.change == Change("notes.md", "?", added=2, removed=0)
    assert _patch_lines(found.patch) == [
        "@@ -0,0 +1,2 @@",
        "+a",
        "+b",
        "\\ No newline at end of file",
    ]
    assert diff(repo, "HEAD", "working-tree", "notes.md", max_bytes=1000).change is not None
    assert diff(repo, "HEAD", "index", "notes.md", max_bytes=1000).change is None
    (repo / ".gitignore").write_text("*.log\n")
    _write(repo, "debug.log", "x\n")
    assert diff(repo, "index", "working-tree", "debug.log", max_bytes=1000).change is None


def test_diff_of_an_untracked_file_from_the_working_tree(repo: Path) -> None:
    _write(repo, "notes.md", "a\nb\n")
    found = diff(repo, "working-tree", "HEAD", "notes.md", max_bytes=1000)
    assert found.change == Change("notes.md", "D", added=0, removed=2)
    assert _patch_lines(found.patch) == ["@@ -1,2 +0,0 @@", "-a", "-b"]
    _write(repo, "image.bin", b"\0\1\2")
    binary = diff(repo, "working-tree", "index", "image.bin", max_bytes=1000)
    assert binary.change == Change("image.bin", "D", binary=True, old_size=3)


def test_no_patch_for_binary_or_large_files(repo: Path) -> None:
    _write(repo, "a.txt", "a\n" * 600)
    _write(repo, "image.bin", b"\0\1\2")
    large = diff(repo, "index", "working-tree", "a.txt", max_bytes=1000)
    assert (large.change is not None, large.patch) == (True, None)
    binary = diff(repo, "index", "working-tree", "image.bin", max_bytes=1000)
    assert binary == diff(repo, "index", "working-tree", "image.bin", max_bytes=1000)
    assert (binary.change, binary.patch) == (Change("image.bin", "?", binary=True, size=3), None)


def test_a_patch_above_max_bytes_is_not_held(repo: Path) -> None:
    _commit(repo, {"data.txt": "old\n" * 1_250_000})  # 5 MB
    _write(repo, "data.txt", "new\n" * 1_250_000)
    tracemalloc.start()
    try:
        found = diff(repo, "HEAD", "working-tree", "data.txt", max_bytes=1000)
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert (found.change is not None, found.patch) == (True, None)
    assert peak < 1_000_000


def test_diff_is_of_a_file(repo: Path) -> None:
    with pytest.raises(ChangesError, match="not of the folder"):
        diff(repo, "index", "working-tree", "src/", max_bytes=1000)
    with pytest.raises(ChangesError, match="within"):
        diff(repo, "index", "working-tree", "../a.txt", max_bytes=1000)


def _changed_files(repo: Path) -> None:
    """A file changed, one renamed, one deleted, one binary, and one untracked."""
    _write(repo, "a.txt", "one\n2\n")
    git(repo, "mv", "old.txt", "new.txt")
    (repo / "gone.txt").unlink()
    _write(repo, "image.bin", b"\0\1\2")
    git(repo, "add", "--all")
    _write(repo, "notes.md", "untracked\n")


def test_diffs_are_each_files_diff(repo: Path) -> None:
    _changed_files(repo)
    found = diffs(repo, "HEAD", "working-tree", max_files=100, max_bytes=1000)
    paths = ["a.txt", "gone.txt", "image.bin", "new.txt"]  # in path order, but untracked
    assert found == Diffs(
        tuple(diff(repo, "HEAD", "working-tree", path, max_bytes=1000) for path in paths),
        None,
        None,
    )
    cut = diffs(repo, "HEAD", "working-tree", max_files=2, max_bytes=1000)
    assert [found.change.path for found in cut.diffs if found.change] == paths[:2]
    assert diffs(repo, "HEAD", "HEAD", max_files=100, max_bytes=1000) == Diffs((), None, None)


def test_diffs_with_new_versions(repo: Path) -> None:
    _changed_files(repo)
    _write(repo, "big.txt", "big\n" * 300)  # its patch is too large
    git(repo, "add", "big.txt")
    found = diffs(repo, "HEAD", "index", max_files=100, max_bytes=1000, new=True)
    assert found.new == {
        "a.txt": "one\n2\n",
        "big.txt": None,
        "gone.txt": None,
        "image.bin": None,
        "new.txt": "same\n" * 5,
    }


def test_diffs_in_pages(repo: Path) -> None:
    _commit(repo, {f"{n}.txt": "x\n" for n in range(10)})
    for n in range(10):
        _write(repo, f"{n}.txt", f"{n}\n" * (n * 20))  # the last over max_bytes alone
    patches: list[str] = []
    skip: int | None = 0
    pages = 0
    while skip is not None:
        page = diffs(repo, "HEAD", "working-tree", max_files=100, max_bytes=400, skip=skip)
        assert page.diffs  # at least one
        held = sum(len((found.patch or "").encode()) for found in page.diffs)
        assert held <= 400 or len(page.diffs) == 1
        patches += [found.change.path for found in page.diffs if found.change]
        skip = page.next
        pages += 1
    assert patches == sorted(f"{n}.txt" for n in range(10))
    assert pages > 2


def test_versions_in_each_state(repo: Path) -> None:
    _write(repo, "a.txt", "staged\n")
    git(repo, "add", "a.txt")
    _write(repo, "a.txt", "changed")  # no newline at the end: kept
    assert versions(repo, "HEAD", "index", "a.txt", max_bytes=1000) == Versions(
        "one\ntwo\n", "staged\n"
    )
    assert versions(repo, "index", "working-tree", "a.txt", max_bytes=1000) == Versions(
        "staged\n", "changed"
    )
    (repo / "gone.txt").unlink()
    _write(repo, "new.txt", "new\n")
    assert versions(repo, "HEAD", "working-tree", "gone.txt", max_bytes=1000) == Versions(
        "x\n", None
    )
    assert versions(repo, "HEAD", "working-tree", "new.txt", max_bytes=1000) == Versions(
        None, "new\n"
    )


def test_versions_larger_than_max_bytes(repo: Path) -> None:
    _write(repo, "a.txt", "a\n" * 600)
    with pytest.raises(ChangesError, match="larger than 1,000 bytes"):
        versions(repo, "HEAD", "working-tree", "a.txt", max_bytes=1000)
    git(repo, "add", "a.txt")
    with pytest.raises(ChangesError, match="larger than 1,000 bytes"):
        versions(repo, "HEAD", "index", "a.txt", max_bytes=1000)


def test_text_that_isnt_utf8(repo: Path) -> None:
    _write(repo, "latin.txt", "café\n".encode("latin-1"))
    found = diff(repo, "index", "working-tree", "latin.txt", max_bytes=1000)
    assert _patch_lines(found.patch) == ["@@ -0,0 +1 @@", "+caf\ufffd"]
    assert versions(repo, "index", "working-tree", "latin.txt", max_bytes=1000).new == "caf\ufffd\n"
