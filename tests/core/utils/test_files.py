import os
from pathlib import Path

import pytest

from hephaistos.core.utils import files
from hephaistos.core.utils.files import FilesError
from support import create, git


def _tree(top: Path) -> Path:
    (top / "src").mkdir(parents=True)
    (top / "src" / "main.py").write_text("print(1)\n")
    (top / ".hidden").write_text("")
    (top / "README").write_text("hello\n")
    (top / "to-src").symlink_to("src")
    (top / "broken").symlink_to("nowhere")
    return top


def _by_name(listing: files.Listing) -> dict[str, files.Entry]:
    return {entry.name: entry for entry in listing.entries}


def test_lists_names_and_kinds_only_unless_asked(tmp_path: Path) -> None:
    found = files.listing(_tree(tmp_path / "d"), max_entries=100)
    assert [entry.name for entry in found.entries] == [
        ".hidden",
        "README",
        "broken",
        "src",
        "to-src",
    ]
    assert found.count == 5
    assert found.top is None
    entries = _by_name(found)
    assert (entries["src"].kind, entries["README"].kind) == ("directory", "file")
    assert entries[".hidden"].hidden
    assert not entries["README"].hidden
    assert (entries["to-src"].kind, entries["to-src"].target, entries["to-src"].to) == (
        "symlink",
        "src",
        "directory",
    )
    assert (entries["broken"].target, entries["broken"].to) == ("nowhere", None)
    assert entries["README"].size is None
    assert entries["README"].modified is None
    assert entries["README"].status is None


def test_gives_sizes_and_times_when_asked(tmp_path: Path) -> None:
    found = files.listing(_tree(tmp_path / "d"), frozenset({"size", "modified"}), max_entries=100)
    entries = _by_name(found)
    assert entries["README"].size == len("hello\n")
    assert entries["src"].size is None  # only files have one
    readme = tmp_path / "d" / "README"
    assert entries["README"].modified is not None
    assert entries["README"].modified.timestamp() == pytest.approx(readme.stat().st_mtime)


def test_lists_at_most_some_counting_all(tmp_path: Path) -> None:
    found = files.listing(_tree(tmp_path / "d"), max_entries=2)
    assert [entry.name for entry in found.entries] == [".hidden", "README"]
    assert found.count == 5


@pytest.mark.parametrize(
    ("path", "reason", "message"),
    [
        ("relative", "invalid", "not an absolute path"),
        ("{tmp}/missing", "missing", "nothing is at"),
        ("{tmp}/file", "invalid", "not a directory"),
    ],
)
def test_refuses_what_it_cant_list(tmp_path: Path, path: str, reason: str, message: str) -> None:
    (tmp_path / "file").write_text("")
    with pytest.raises(FilesError, match=message) as raised:
        files.listing(Path(path.format(tmp=tmp_path)), max_entries=100)
    assert raised.value.reason == reason


@pytest.mark.skipif(os.geteuid() == 0, reason="root may list anything")
def test_refuses_a_directory_it_may_not_list(tmp_path: Path) -> None:
    closed = tmp_path / "closed"
    closed.mkdir(mode=0o000)
    try:
        with pytest.raises(FilesError, match="not allowed") as raised:
            files.listing(closed, max_entries=100)
        assert raised.value.reason == "denied"
    finally:
        closed.chmod(0o700)


def test_refuses_a_directory_that_fails_to_read(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def failing(_path: object) -> None:
        raise OSError(5, "Input/output error")

    monkeypatch.setattr(files.os, "scandir", failing)  # as a network filesystem may
    with pytest.raises(FilesError, match=r"could not list .*: Input/output error") as raised:
        files.listing(tmp_path, max_entries=100)
    assert raised.value.reason == "unreadable"


def test_lists_a_symlink_gone_meanwhile(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    top = _tree(tmp_path / "d")

    def gone(path: Path) -> Path:
        raise FileNotFoundError(path)

    monkeypatch.setattr(Path, "readlink", gone)  # removed after the listing named it
    entries = _by_name(files.listing(top, frozenset({"size", "modified"}), max_entries=100))
    assert (entries["to-src"].kind, entries["to-src"].target) == ("symlink", None)
    assert entries["README"].size == len("hello\n")


def test_says_what_git_says_in_a_working_tree(tmp_path: Path) -> None:
    repo = create(tmp_path / "repo")
    (repo / ".gitignore").write_text("*.log\nbuild/\n")
    (repo / "lib").mkdir()
    (repo / "lib" / "kept.py").write_text("x = 1\n")
    (repo / "docs").mkdir()
    (repo / "docs" / "guide.md").write_text("old\n")
    git(repo, "add", ".")
    git(repo, "commit", "--quiet", "-m", "more")
    (repo / "docs" / "guide.md").write_text("new\n")
    (repo / "new.txt").write_text("")
    (repo / "fresh").mkdir()
    (repo / "fresh" / "a").write_text("")
    (repo / "run.log").write_text("")
    (repo / "build").mkdir()
    (repo / "build" / "out").write_text("")
    git(repo, "add", "new.txt")

    found = files.listing(repo, frozenset({"git"}), max_entries=100)
    assert found.top == repo.resolve()
    entries = _by_name(found)
    assert entries["new.txt"].status == "A"
    assert entries["fresh"].status == "?"
    assert (entries["run.log"].ignored, entries["build"].ignored) == (True, True)
    assert (entries["lib"].status, entries["lib"].ignored, entries["lib"].changed) == (
        None,
        False,
        False,
    )
    assert entries["docs"].changed
    assert entries["new.txt"].changed is None  # only directories say so

    inside = _by_name(files.listing(repo / "docs", frozenset({"git"}), max_entries=100))
    assert inside["guide.md"].status == "M"


def test_lists_without_git_s_letters_where_git_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = create(tmp_path / "repo")
    (repo / "new.txt").write_text("")
    read = files.git.read

    def slow(path: Path, *args: str, stdin: str | None = None) -> str:
        if "status" in args:
            raise files.git.GitTimeoutError("git status took too long")
        return read(path, *args, stdin=stdin)

    monkeypatch.setattr(files.git, "read", slow)
    found = files.listing(repo, frozenset({"git"}), max_entries=100)
    assert found.top == repo.resolve()  # still in its working tree
    assert all(entry.status is None for entry in found.entries)


def test_says_nothing_of_git_outside_a_working_tree(tmp_path: Path) -> None:
    found = files.listing(_tree(tmp_path / "d"), frozenset({"git"}), max_entries=100)
    assert found.top is None
    assert all(entry.status is None and entry.ignored is None for entry in found.entries)
