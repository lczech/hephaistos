import os
import shutil
from pathlib import Path

import pytest

from hephaistos.core.db.sessions import read_session, write_session
from hephaistos.core.observers import clones as observer
from hephaistos.core.registry import clones, machines, repositories, scan
from hephaistos.core.registry.scan import Action, Planned
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.paths import Paths
from support import clone, create, git


@pytest.fixture
def set_up(paths: Paths) -> Paths:
    machines.set_up(paths, "laptop")
    return paths


def plan(paths: Paths, root: Path, depth: int = scan.DEPTH) -> list[Planned]:
    with read_session(paths) as session:
        return scan.plan(session, root, depth)


def actions(planned: list[Planned], root: Path) -> dict[str, tuple[Action, str | None]]:
    """The rows by path relative to `root`, with their actions and Repositories."""
    return {
        str(row.path.relative_to(root, walk_up=True)): (row.action, row.repository)
        for row in planned
    }


def add(paths: Paths, planned: list[Planned]) -> None:
    with write_session(paths) as session:
        scan.add(session, planned)


def add_clone(paths: Paths, path: Path, repository: str) -> None:
    """Adds the Clone at `path` to `repository`, creating it if needed, and observes it."""
    with write_session(paths) as session:
        if repository not in {s.repository.name for s in repositories.summaries(session)}:
            repositories.add(session, repository)
        added = clones.add(session, repository, clones.inspect(path))
    observer.observe(paths, [added.id])


def test_new_repositories_and_clones_joining_them(set_up: Paths, tmp_path: Path) -> None:
    root = tmp_path / "Repos"
    first = create(root / "first", origin="git@host:me/proj.git")
    copy = clone(first, root / "second")
    git(copy, "remote", "set-url", "origin", "https://host/me/proj")
    create(root / "org" / "other")
    planned = plan(set_up, root)
    assert actions(planned, root) == {
        "first": (Action.NEW, "proj"),
        "second": (Action.JOIN, "proj"),
        "org/other": (Action.NEW, "other"),
    }
    assert (planned[2].note, planned[2].about) == ("new, with", first)

    add(set_up, planned)
    with read_session(set_up) as session:
        found = {(d.repository.name, d.clone.display_path) for d in clones.details(session)}
    assert found == {("proj", first), ("proj", copy), ("other", root / "org" / "other")}
    assert {row.action for row in plan(set_up, root)} == {Action.KNOWN}


def test_joining_stored_repositories(set_up: Paths, tmp_path: Path) -> None:
    source = create(tmp_path / "source")
    add_clone(set_up, source, "proj")
    root = tmp_path / "Repos"
    clone(source, root / "copy")
    assert actions(plan(set_up, root), root) == {"copy": (Action.JOIN, "proj")}


def test_walk(set_up: Paths, tmp_path: Path) -> None:
    root = tmp_path / "Repos"
    found = create(root / "a" / "b" / "found")
    create(root / "a" / "b" / "c" / "too-deep")
    create(root / ".hidden" / "repo")
    create(found / "nested")
    (root / "link").symlink_to(found)
    (root / "a" / "loop").symlink_to(root)
    assert actions(plan(set_up, root), root) == {"a/b/found": (Action.NEW, "found")}
    assert "a/b/c/too-deep" in actions(plan(set_up, root, depth=4), root)
    assert actions(plan(set_up, root, depth=1), root) == {"link": (Action.NEW, "link")}


def test_walk_prefers_real_paths(set_up: Paths, tmp_path: Path) -> None:
    root = tmp_path / "Repos"
    real = create(root / "z" / "real")
    (root / "a-link").symlink_to(real)
    (root / "b-link").symlink_to(root / "z")
    assert actions(plan(set_up, root), root) == {"z/real": (Action.NEW, "real")}


def test_starting_at_or_in_a_clone(set_up: Paths, tmp_path: Path) -> None:
    repo = create(tmp_path / "repo")
    (repo / "sub").mkdir()
    assert actions(plan(set_up, repo), tmp_path) == {"repo": (Action.NEW, "repo")}
    with pytest.raises(HephaistosError, match=r"repo/sub is inside the Clone at"):
        plan(set_up, repo / "sub")
    with pytest.raises(HephaistosError, match="no such directory"):
        plan(set_up, tmp_path / "nope")


def test_names_are_never_guessed(set_up: Paths, tmp_path: Path) -> None:
    add_clone(set_up, create(tmp_path / "taken"), "taken")
    with write_session(set_up) as session:
        repositories.add(session, "empty")
    root = tmp_path / "Repos"
    for path in ("utils", "org/utils", "taken", "empty", "org/empty"):
        create(root / path)
    planned = {str(row.path.relative_to(root)): row for row in plan(set_up, root)}
    assert {row.action for row in planned.values()} == {Action.SKIP}
    assert planned["utils"].note == "2 new Repositories would be named utils"
    assert planned["utils"].fix == (
        "hephaistos repo add <name>",
        f"hephaistos clone add {root / 'utils'} --repo <name>",
    )
    assert planned["taken"].note == "the name taken is taken by an unrelated Repository"
    assert planned["empty"].note == "2 new Repositories would be named empty"
    assert planned["empty"].fix == (f"hephaistos clone add {root / 'empty'} --repo empty",)


def test_repository_without_clones_is_joined_by_name(set_up: Paths, tmp_path: Path) -> None:
    with write_session(set_up) as session:
        repositories.add(session, "proj")
    root = tmp_path / "Repos"
    first = create(root / "proj")
    clone(first, root / "proj-copy")
    assert actions(plan(set_up, root), root) == {
        "proj": (Action.JOIN, "proj"),
        "proj-copy": (Action.JOIN, "proj"),
    }


def test_new_repository_named_after_a_remote_not_on_this_machine(
    set_up: Paths, tmp_path: Path
) -> None:
    root = tmp_path / "Repos"
    source = create(root / "source", origin="git@host:me/tool.git")
    clone(source, root / "a-copy")  # origin: the path of `source`
    assert actions(plan(set_up, root), root) == {
        "a-copy": (Action.NEW, "tool"),
        "source": (Action.JOIN, "tool"),
    }
    assert actions(plan(set_up, root / "a-copy"), root) == {"a-copy": (Action.NEW, "source")}


def test_matching_several_repositories_is_skipped(set_up: Paths, tmp_path: Path) -> None:
    source = create(tmp_path / "source")
    add_clone(set_up, source, "one")
    add_clone(set_up, clone(source, tmp_path / "copy"), "two")
    root = tmp_path / "Repos"
    clone(source, root / "third")
    [row] = plan(set_up, root)
    assert (row.action, row.note) == (Action.SKIP, "matches one, two")
    assert row.fix == (f"hephaistos clone add {root / 'third'} --repo <name>",)


def test_worktrees(set_up: Paths, tmp_path: Path) -> None:
    root = tmp_path / "Repos"
    stored = create(root / "stored")
    git(stored, "worktree", "add", "--quiet", str(root / "observed"))
    add_clone(set_up, stored, "stored")
    git(stored, "worktree", "add", "--quiet", str(root / "unobserved"))
    elsewhere = create(tmp_path / "elsewhere")
    git(elsewhere, "worktree", "add", "--quiet", str(root / "linked"))
    broken = create(tmp_path / "broken")
    git(broken, "worktree", "add", "--quiet", str(root / "orphan"))
    shutil.rmtree(broken)

    planned = plan(set_up, root)
    assert actions(planned, root) == {
        "stored": (Action.KNOWN, "stored"),
        "observed": (Action.KNOWN, "stored"),
        "unobserved": (Action.OBSERVE, "stored"),
        "../elsewhere": (Action.NEW, "elsewhere"),
        "linked": (Action.WORKTREE, None),
        "orphan": (Action.SKIP, None),
    }
    by_path = {row.path: row for row in planned}
    with read_session(set_up) as session:
        assert by_path[root / "unobserved"].clone_id == clones.find(session, stored).clone.id
    assert (by_path[elsewhere].note, by_path[elsewhere].about) == (
        "for the Worktree",
        root / "linked",
    )


@pytest.mark.skipif(os.geteuid() == 0, reason="root reads any directory")
def test_unreadable_directories(set_up: Paths, tmp_path: Path) -> None:
    root = tmp_path / "Repos"
    locked = root / "locked"
    locked.mkdir(parents=True)
    locked.chmod(0)
    try:
        [row] = plan(set_up, root)
    finally:
        locked.chmod(0o755)
    assert (row.path, row.action, row.note) == (locked, Action.UNREADABLE, "Permission denied")


def test_add_is_all_or_nothing(set_up: Paths, tmp_path: Path) -> None:
    root = tmp_path / "Repos"
    create(root / "first")
    second = create(root / "second")
    planned = plan(set_up, root)
    add_clone(set_up, second, "meanwhile")
    with pytest.raises(HephaistosError, match="already a Clone of meanwhile"):
        add(set_up, planned)
    with read_session(set_up) as session:
        names = [summary.repository.name for summary in repositories.summaries(session)]
    assert names == ["meanwhile"]
