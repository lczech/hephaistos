import json
import shutil
from pathlib import Path

import pytest

from hephaistos.core.db.sessions import read_session, write_session
from hephaistos.core.db.tables import Table
from hephaistos.core.events import events
from hephaistos.core.events.kinds import EventKind
from hephaistos.core.observers import clones as observer
from hephaistos.core.registry import clones, machines, records, repositories
from hephaistos.core.registry.clones import Candidate, CloneDetails
from hephaistos.core.registry.filesystems import Filesystem
from hephaistos.core.registry.mounts import Mount
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.git import Snapshot
from hephaistos.core.utils.ids import new_id
from hephaistos.core.utils.paths import Paths
from support import clone, create, git, submodule


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


def test_submodule_is_refused(tmp_path: Path) -> None:
    outer = create(tmp_path / "outer")
    lib = submodule(create(tmp_path / "lib"), outer, "lib")
    (lib / "src").mkdir()
    with pytest.raises(HephaistosError, match=r"outer/lib is a submodule of .*outer; add that"):
        clones.inspect(lib / "src")
    assert clones.inspect(outer).resolved_path == outer.resolve()


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


def test_paths_in_repositories_of_their_own_are_refused(set_up: Paths, tmp_path: Path) -> None:
    outer = create(tmp_path / "outer")
    tool = create(outer / "vendor" / "tool")
    lib = submodule(create(tmp_path / "lib"), outer, "lib")
    (lib / "src").mkdir()
    add(set_up, outer)
    nested = r"vendor/tool is a git repository of its own, not a Clone; run this in the Clone at"
    inside = r"lib/src is in the submodule at .*outer/lib; run this in the Clone at"
    with read_session(set_up) as session:
        for path, message in [(tool, nested), (lib / "src", inside)]:
            with pytest.raises(HephaistosError, match=message):
                clones.find(session, path)
            with pytest.raises(HephaistosError, match=message):
                clones.find_unobserved(session, path)
        assert clones.find(session, outer / "vendor").clone.resolved_path == outer.resolve()
    with write_session(set_up) as session, pytest.raises(HephaistosError, match=nested):
        clones.remove(session, tool)
    with read_session(set_up) as session:
        assert [details.clone.resolved_path for details in clones.details(session)] == [outer]


def test_clone_without_its_repository_is_found_inside_another(
    set_up: Paths, tmp_path: Path
) -> None:
    dotfiles = create(tmp_path / "dotfiles")  # e.g. a home directory kept in git
    repo = create(dotfiles / "repo")
    add(set_up, repo)
    shutil.rmtree(repo / ".git")
    with read_session(set_up) as session:
        assert clones.find(session, repo).clone.resolved_path == repo


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


def test_remove_all_removes_the_expected(set_up: Paths, tmp_path: Path) -> None:
    repo = create(tmp_path / "repo")
    first = add(set_up, repo)
    second = add(set_up, clone(repo, tmp_path / "copy"))
    with write_session(set_up) as session:
        repository = repositories.by_name(session, "proj")
        with pytest.raises(HephaistosError, match="changed meanwhile"):
            clones.remove_all(session, repository, [first.clone.id])
        clones.remove_all(session, repository, [first.clone.id, second.clone.id])
    with read_session(set_up) as session:
        assert clones.details(session) == []


def move(paths: Paths, old: Path, new: Path, *, nested: bool = False) -> list[CloneDetails]:
    """Records the move of the Clone at `old` to `new`; returns the Clones as stored after it."""
    with read_session(paths) as session:
        planned = clones.moves(session, old, new, nested=nested)
    with write_session(paths) as session:
        clones.move(session, planned)
    with read_session(paths) as session:
        return clones.details(session)


def test_move_keeps_the_clone(set_up: Paths, tmp_path: Path) -> None:
    added = add(set_up, create(tmp_path / "a" / "repo"))
    moved = (tmp_path / "a" / "repo").rename(tmp_path / "repo")  # one level up
    [details] = move(set_up, tmp_path / "a" / "repo", moved)
    assert details.clone.id == added.clone.id
    assert details.clone.display_path == moved
    with read_session(set_up) as session:
        row = session.conn.execute(
            "SELECT kind, payload FROM events ORDER BY recorded_at DESC LIMIT 1"
        ).fetchone()
    assert row["kind"] == "clone.moved"
    assert json.loads(row["payload"])["display_path"] == {
        "old": str(tmp_path / "a" / "repo"),
        "new": str(moved),
    }


def test_move_refusals(set_up: Paths, tmp_path: Path) -> None:
    repo = create(tmp_path / "repo")
    add(set_up, repo)
    git(repo, "worktree", "add", "--quiet", str(tmp_path / "wt"))
    observer.observe(set_up)
    copy = clone(repo, tmp_path / "copy")
    with pytest.raises(HephaistosError, match="repo is still a git repository"):
        move(set_up, repo, copy)
    moved = repo.rename(tmp_path / "moved")
    with pytest.raises(HephaistosError, match="`git worktree move` moves Worktrees"):
        move(set_up, tmp_path / "wt", moved)
    with pytest.raises(HephaistosError, match="shares no history with the Clone at"):
        move(set_up, repo, create(tmp_path / "other"))
    add(set_up, copy)
    with pytest.raises(HephaistosError, match="copy is already a Clone of proj"):
        move(set_up, repo, copy)


@pytest.mark.parametrize(
    ("old", "target", "typed"),
    [
        ("a/repo", "repo", "repo"),  # up a level
        ("a/repo", "a/b/c/repo", "a/b/c/repo"),  # down
        ("a/repo", "real/repo", "link/repo"),  # through a symlink, which the record keeps
        ("a/repo/sub", "repo", "repo"),  # the old Clone named by a path inside it
    ],
)
def test_move_shapes(set_up: Paths, tmp_path: Path, old: str, target: str, typed: str) -> None:
    repo = create(tmp_path / "a" / "repo")
    (repo / "sub").mkdir()
    added = add(set_up, repo)
    (tmp_path / "real").mkdir()
    (tmp_path / "link").symlink_to(tmp_path / "real")
    (tmp_path / target).parent.mkdir(parents=True, exist_ok=True)
    repo.rename(tmp_path / target)
    [details] = move(set_up, tmp_path / old, tmp_path / typed)
    assert details.clone.id == added.clone.id
    assert details.clone.display_path == tmp_path / typed
    assert details.clone.resolved_path == (tmp_path / target).resolve()


def test_move_onto_another_filesystem(set_up: Paths, tmp_path: Path) -> None:
    shared = tmp_path / "shared"
    shared.mkdir()
    filesystem = Filesystem(id=new_id(), name="shared")
    with write_session(set_up) as session:
        records.add(session, Table.REGISTRY_FILESYSTEMS, EventKind.FILESYSTEM_ADDED, filesystem)
        mount = Mount(
            id=new_id(),
            machine_id=session.machine_id,
            filesystem_id=filesystem.id,
            path=shared.resolve(),
        )
        records.add(session, Table.REGISTRY_MOUNTS, EventKind.MOUNT_ADDED, mount)
    repo = create(tmp_path / "repo")
    before = add(set_up, repo)
    [details] = move(set_up, repo, repo.rename(shared / "repo"))
    assert details.filesystem == filesystem
    with read_session(set_up) as session:
        [moved] = events.recent(session, kinds=["clone.moved"])
    assert moved.payload["filesystem_id"] == {
        "old": str(before.filesystem.id),
        "new": str(filesystem.id),
    }


def test_move_leaves_a_locked_worktree_behind(set_up: Paths, tmp_path: Path) -> None:
    """A locked Worktree that is away (e.g. on an unplugged disk) doesn't block a move."""
    repo = create(tmp_path / "repo")
    git(repo, "worktree", "add", "--quiet", str(tmp_path / "usb"))
    git(repo, "worktree", "lock", str(tmp_path / "usb"))
    add(set_up, repo)
    shutil.rmtree(tmp_path / "usb")
    [details] = move(set_up, repo, repo.rename(tmp_path / "moved"))
    assert details.clone.display_path == tmp_path / "moved"


def test_move_refuses_a_clone_changed_meanwhile(set_up: Paths, tmp_path: Path) -> None:
    repo = create(tmp_path / "repo")
    add(set_up, repo)
    moved = repo.rename(tmp_path / "moved")
    with read_session(set_up) as session:
        planned = clones.moves(session, repo, moved)
    with write_session(set_up) as session:
        clones.remove(session, repo)
    with write_session(set_up) as session, pytest.raises(HephaistosError, match="meanwhile"):
        clones.move(session, planned)


def test_move_bare(set_up: Paths, tmp_path: Path) -> None:
    bare = clone(create(tmp_path / "source"), tmp_path / "bare.git", bare=True)
    added = add(set_up, bare)
    [details] = move(set_up, bare, bare.rename(tmp_path / "moved.git"))
    assert (details.clone.id, details.state.bare) == (added.clone.id, True)


def test_move_into_its_own_subdirectory(set_up: Paths, tmp_path: Path) -> None:
    """The old path may exist again, within the repository, without being one."""
    repo = create(tmp_path / "repo")
    add(set_up, repo)
    (tmp_path / "parent").mkdir()
    moved = repo.rename(tmp_path / "parent" / "repo")
    parent = (tmp_path / "parent").rename(tmp_path / "repo")  # the old path again
    moved = parent / "repo"
    [details] = move(set_up, repo, moved)
    assert details.clone.display_path == moved


def test_move_waits_for_worktrees_to_be_repaired(set_up: Paths, tmp_path: Path) -> None:
    repo = create(tmp_path / "repo")
    git(repo, "worktree", "add", "--quiet", str(repo / ".worktrees" / "inside"))
    git(repo, "worktree", "add", "--quiet", str(tmp_path / "outside"))
    git(repo, "worktree", "add", "--quiet", str(tmp_path / "deleted"))
    add(set_up, repo)
    observer.observe(set_up)
    moved = repo.rename(tmp_path / "moved")
    shutil.rmtree(tmp_path / "deleted")
    with pytest.raises(HephaistosError) as raised:
        move(set_up, repo, moved)
    assert str(raised.value).splitlines() == [
        f"the links to Worktrees of {moved} are broken; repair them first:",
        (
            f"  git -C {moved} worktree repair <new path of {tmp_path / 'deleted'}>"
            f" {moved / '.worktrees' / 'inside'}"
        ),
        f"  (for a deleted Worktree: git -C {moved} worktree prune)",
    ]

    git(moved, "worktree", "repair", str(moved / ".worktrees" / "inside"))
    git(moved, "worktree", "prune")
    move(set_up, repo, moved)
    observer.observe(set_up)
    with read_session(set_up) as session:
        [details] = clones.details(session)
        removed = events.recent(session, kinds=["worktree.removed"])
    # The moved ones are the same Worktrees: only the deleted one was removed.
    assert {worktree.name: worktree.path for worktree in details.worktrees} == {
        "inside": moved / ".worktrees" / "inside",
        "outside": tmp_path / "outside",
    }
    assert [event.payload["path"] for event in removed] == [str(tmp_path / "deleted")]


def test_move_nested(set_up: Paths, tmp_path: Path) -> None:
    outer = create(tmp_path / "outer")
    add(set_up, outer)
    with write_session(set_up) as session:
        repositories.add(session, "lib")
    add(set_up, create(outer / "vendor" / "lib"), "lib")
    with read_session(set_up) as session:
        nested = clones.nested_clones(session, clones.find(session, outer))
    assert [details.clone.display_path for details in nested] == [outer / "vendor" / "lib"]
    moved = outer.rename(tmp_path / "moved")
    paths = {details.clone.display_path for details in move(set_up, outer, moved)}
    assert paths == {moved, outer / "vendor" / "lib"}


def test_move_nested_moves_all_or_nothing(set_up: Paths, tmp_path: Path) -> None:
    outer = create(tmp_path / "outer")
    add(set_up, outer)
    with write_session(set_up) as session:
        repositories.add(session, "lib")
    add(set_up, create(outer / "vendor" / "lib"), "lib")
    moved = outer.rename(tmp_path / "moved")
    paths = {d.clone.display_path for d in move(set_up, outer, moved, nested=True)}
    assert paths == {moved, moved / "vendor" / "lib"}

    again = moved.rename(tmp_path / "again")
    shutil.rmtree(again / "vendor")
    with pytest.raises(HephaistosError, match=r"(?s)no such directory.*separately, or leave out"):
        move(set_up, moved, again, nested=True)
    with read_session(set_up) as session:
        assert {d.clone.display_path for d in clones.details(session)} == paths


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
