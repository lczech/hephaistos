import os
from pathlib import Path

import pytest

from hephaistos.core.utils import file_search
from hephaistos.core.utils.file_search import PatternError
from support import create, git, submodule


def _paths(
    path: Path, *, hidden: bool = True, ignored: bool = False, max_paths: int = 1000
) -> file_search.Paths:
    return file_search.paths(path, hidden=hidden, ignored=ignored, max_paths=max_paths, seconds=10)


def _tree(top: Path) -> Path:
    (top / "src" / "deep").mkdir(parents=True)
    (top / "src" / "deep" / "main.py").write_text("")
    (top / ".config").mkdir()
    (top / ".config" / "a").write_text("")
    (top / "README").write_text("")
    (top / "to-src").symlink_to("src")
    return top


def test_walks_everything_below_folders_marked(tmp_path: Path) -> None:
    found = _paths(_tree(tmp_path / "d"))
    assert found.paths == (
        ".config/",
        ".config/a",
        "README",
        "src/",
        "src/deep/",
        "src/deep/main.py",
        "to-src",  # not followed
    )
    assert (found.stopped, found.limit) == (None, None)


def test_leaves_hidden_ones_out_unless_asked(tmp_path: Path) -> None:
    found = _paths(_tree(tmp_path / "d"), hidden=False)
    assert ".config/" not in found.paths
    assert ".config/a" not in found.paths


def test_stops_at_the_limit_saying_so(tmp_path: Path) -> None:
    found = _paths(_tree(tmp_path / "d"), max_paths=3)
    assert len(found.paths) == 3
    assert (found.stopped, found.limit) == ("max_paths", 3)


def test_does_not_stop_at_exactly_the_limit(tmp_path: Path) -> None:
    found = _paths(_tree(tmp_path / "d"), max_paths=7)  # all there are
    assert len(found.paths) == 7
    assert (found.stopped, found.limit) == (None, None)


def test_stops_when_the_time_is_up(tmp_path: Path) -> None:
    found = file_search.paths(
        _tree(tmp_path / "d"), hidden=True, ignored=False, max_paths=1000, seconds=1e-9
    )
    assert (found.stopped, found.limit) == ("time", 1e-9)


def _repo(tmp_path: Path) -> Path:
    repo = create(tmp_path / "repo")
    (repo / ".gitignore").write_text("build/\n")
    (repo / "lib").mkdir()
    (repo / "lib" / "kept.py").write_text("")
    (repo / "gone.txt").write_text("")
    git(repo, "add", ".")
    git(repo, "commit", "--quiet", "-m", "more")
    (repo / "gone.txt").unlink()
    (repo / "new.txt").write_text("")
    (repo / "build").mkdir()
    (repo / "build" / "out").write_text("")
    nested = create(repo / "nested")  # a working tree in it, untracked
    (nested / "build").mkdir()
    (nested / "build" / "x").write_text("")
    (nested / "kept").write_text("")
    return repo


def test_lists_what_git_does_in_a_working_tree(tmp_path: Path) -> None:
    found = _paths(_repo(tmp_path))
    assert "lib/" in found.paths
    assert "lib/kept.py" in found.paths
    assert "new.txt" in found.paths  # untracked
    assert "gone.txt" not in found.paths  # deleted
    assert "build/" not in found.paths  # ignored
    assert "nested/kept" in found.paths
    assert "nested/build/x" in found.paths  # its own .gitignore does not name it
    assert {".git/", "nested/.git/"} <= set(found.paths)  # by their names
    assert not [path for path in found.paths if ".git" in path.rstrip("/").split("/")[:-1]]


def test_walks_what_git_ignores_too_if_asked(tmp_path: Path) -> None:
    found = _paths(_repo(tmp_path), ignored=True)
    assert "build/out" in found.paths
    assert ".git/" in found.paths  # its name, never what is in it
    assert not [path for path in found.paths if path.startswith(".git/") and path != ".git/"]


def test_lists_all_in_an_ignored_folder_searched(tmp_path: Path) -> None:
    found = _paths(_repo(tmp_path) / "build")
    assert found.paths == ("out",)


def test_lists_through_git_from_a_folder_below_the_top(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    (repo / "lib" / "build").mkdir()
    (repo / "lib" / "build" / "x").write_text("")  # ignored by the top's .gitignore
    assert _paths(repo / "lib").paths == ("kept.py",)


def test_walks_into_working_trees_below_a_plain_folder(tmp_path: Path) -> None:
    _repo(tmp_path)
    found = _paths(tmp_path)
    assert "repo/lib/kept.py" in found.paths
    assert "repo/build/" not in found.paths


def test_lists_submodules_and_linked_worktrees_as_working_trees(tmp_path: Path) -> None:
    library = create(tmp_path / "library")
    (library / "lib.py").write_text("")
    git(library, "add", ".")
    git(library, "commit", "--quiet", "-m", "lib")
    repo = _repo(tmp_path)
    inner = submodule(library, repo, "vendor")
    (inner / "build").mkdir()
    (inner / "build" / "x").write_text("")  # ignored by the superproject's .gitignore only
    linked = tmp_path / "linked"
    git(repo, "worktree", "add", "--quiet", str(linked))
    (linked / "build").mkdir()
    (linked / "build" / "out").write_text("")  # ignored

    found = _paths(repo)
    assert "vendor/" in found.paths
    assert "vendor/lib.py" in found.paths
    assert "vendor/build/x" in found.paths
    assert set(_paths(inner).paths) == {".git", "lib.py", "build/", "build/x"}  # from inside
    beside = _paths(tmp_path)
    assert "linked/lib/kept.py" in beside.paths  # its `.git` a file
    assert "linked/build/" not in beside.paths
    assert "linked/.git" in beside.paths  # its name


def test_leaves_hidden_ones_out_of_git_s_list_unless_asked(tmp_path: Path) -> None:
    repo = _repo(tmp_path)
    (repo / ".config").mkdir()
    (repo / ".config" / "x").write_text("")
    (repo / "lib" / ".secret").write_text("")
    found = _paths(repo, hidden=False)
    assert "lib/kept.py" in found.paths
    assert not [path for path in found.paths if "/." in f"/{path}"]
    assert ".config/x" in _paths(repo).paths


@pytest.mark.skipif(os.geteuid() == 0, reason="root may list anything")
def test_skips_folders_it_may_not_list(tmp_path: Path) -> None:
    top = _tree(tmp_path / "d")
    closed = top / "closed"
    closed.mkdir()
    (closed / "inside").write_text("")
    closed.chmod(0o000)
    try:
        found = _paths(top)
    finally:
        closed.chmod(0o700)
    assert "closed/" in found.paths
    assert "closed/inside" not in found.paths
    assert "src/deep/main.py" in found.paths


def test_walks_a_git_directory_searched_itself(tmp_path: Path) -> None:
    found = _paths(_repo(tmp_path) / ".git")
    assert "HEAD" in found.paths


def test_stops_when_the_time_is_up_in_a_working_tree(tmp_path: Path) -> None:
    found = file_search.paths(
        _repo(tmp_path), hidden=True, ignored=False, max_paths=1000, seconds=1e-9
    )
    assert (found.stopped, found.paths) == ("time", (".git/",))  # before git's list


@pytest.mark.parametrize(
    ("text", "options", "matched"),
    [
        ("main", {}, ["src/deep/main.py"]),
        ("MAIN", {}, ["src/deep/main.py"]),
        ("MAIN", {"case": True}, []),
        ("src", {}, ["src/", "to-src"]),  # names only: not what is in src/
        ("src", {"word": True}, ["src/", "to-src"]),  # `-` ends a word
        ("deep/main", {}, ["src/deep/main.py"]),  # a `/`: paths
        (r"^\w+$", {"regex": True}, ["README", "src/", "src/deep/"]),
    ],
)
def test_matches_names_or_paths(text: str, options: dict[str, bool], matched: list[str]) -> None:
    found = file_search.Paths(
        Path("/d"), ("README", "src/", "src/deep/", "src/deep/main.py", "to-src")
    )
    assert file_search.matching(found, text, **options) == matched


def test_refuses_an_invalid_expression() -> None:
    with pytest.raises(PatternError, match="invalid regular expression"):
        file_search.matching(file_search.Paths(Path("/d"), ()), "(", regex=True)
