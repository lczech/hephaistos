"""The development scripts under scripts/, run as a developer runs them, on throwaway checkouts."""

import shutil
import subprocess
from pathlib import Path

import pytest

from support import ROOT, create, git


def worktree_with_scripts(tmp_path: Path, name: str) -> Path:
    """A git worktree `name` of a new repository, holding a copy of our scripts."""
    main = create(tmp_path / "main")
    worktree = tmp_path / "worktrees" / name
    git(main, "worktree", "add", "--quiet", str(worktree))
    shutil.copytree(ROOT / "scripts", worktree / "scripts")
    return worktree


def worktree_gui(worktree: Path, root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["sh", str(worktree / "scripts" / "worktree_gui.sh"), *args],
        env={"PATH": "/usr/bin:/bin", "HOME": str(root.parent), "WORKTREE_GUI_ROOT": str(root)},
        capture_output=True,
        text=True,
        check=False,
    )


def instance(root: Path, name: str, worktree: Path | str) -> Path:
    """An instance directory as `worktree_gui.sh start` leaves it, of a Daemon not running."""
    directory = root / name
    (directory / "home").mkdir(parents=True)
    (directory / "worktree").write_text(f"{worktree}\n")
    (directory / "port").write_text("8300\n")
    return directory


@pytest.mark.parametrize("command", ["stop", "remove"])
def test_worktree_gui_leaves_the_instance_of_another_worktree_of_the_same_name(
    tmp_path: Path, command: str
) -> None:
    worktree = worktree_with_scripts(tmp_path, "feature")
    root = tmp_path / "instances"
    theirs = instance(root, "feature", "/elsewhere/feature")

    result = worktree_gui(worktree, root, command)

    assert result.returncode == 1
    assert "/elsewhere/feature" in result.stderr
    assert (theirs / "home").is_dir()


def test_worktree_gui_removes_the_instance_of_this_worktree(tmp_path: Path) -> None:
    worktree = worktree_with_scripts(tmp_path, "feature")
    root = tmp_path / "instances"
    ours = instance(root, "feature", worktree)

    result = worktree_gui(worktree, root, "remove")

    assert result.returncode == 0, result.stderr
    assert not ours.exists()
