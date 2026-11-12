"""What a graph of a Clone shows besides its commits, from git each time it is asked.

Where the HEAD of each of its Checkouts is, its default branch, how far each local branch is
ahead of it and behind it, and where a walk of its branches starts: all local branches and
every HEAD, or only the branches of Checkouts, less those hidden.
"""

from collections.abc import Collection
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from hephaistos.core.utils import changes, git
from hephaistos.core.utils.history import Refs

# Which branches a graph walks from: all local ones, or those checked out in Checkouts.
type Branches = Literal["local", "worktrees"]

_COMMON_DEFAULTS = ("main", "master")  # the names git and forges give a default branch


@dataclass(frozen=True)
class Head:
    """Where a Checkout of a Clone is: its main working tree or a Worktree, as git lists them."""

    path: Path
    commit: str | None  # None before the first commit
    branch: str | None  # None when detached
    main: bool  # the main working tree, not a linked Worktree


@dataclass(frozen=True)
class Standing:
    """How far a branch is ahead of another and behind it: `against` names the other."""

    ahead: int
    behind: int
    against: str


def heads(top: Path) -> tuple[Head, ...]:
    """The HEADs of the Checkouts of the repository at `top`.

    Its main working tree, unless bare, then its Worktrees; not those whose directory is gone,
    which git calls prunable.
    """
    output = git.read(top, "worktree", "list", "--porcelain")
    found: list[Head] = []
    for at, record in enumerate(output.split("\n\n")):
        lines = record.splitlines()
        if not lines or not lines[0].startswith("worktree "):
            continue
        fields: dict[str, str] = {}
        for line in lines[1:]:
            key, _, value = line.partition(" ")
            fields[key] = value
        if "bare" in fields or "prunable" in fields:
            continue
        commit = fields.get("HEAD")
        branch = fields.get("branch")
        found.append(
            Head(
                path=Path(changes.utf8_text(lines[0].removeprefix("worktree "))),
                commit=None if commit is None or set(commit) == {"0"} else commit,
                branch=None
                if branch is None
                else changes.utf8_text(branch.removeprefix("refs/heads/")),
                main=at == 0,
            )
        )
    return tuple(found)


def default_branch(top: Path, known: Refs) -> str | None:
    """The default branch, among the local ones; None if none of those named is here.

    As `origin/HEAD` names it, else as `init.defaultBranch` names new ones, else main, else
    master.
    """
    local = {ref.name for ref in known.refs if ref.kind == "branch"}
    named: list[str] = []
    origin = git.run(top, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD")
    if origin.returncode == 0:
        named.append(origin.stdout.strip().removeprefix("origin/"))
    configured = git.run(top, "config", "--get", "init.defaultBranch")
    if configured.returncode == 0:
        named.append(configured.stdout.strip())
    return next((name for name in (*named, *_COMMON_DEFAULTS) if name in local), None)


def standings(top: Path, default: str | None, known: Refs) -> dict[str, Standing]:
    """How far each local branch is ahead of the default branch and behind it.

    The default branch itself against its upstream, if it has one. None without a default
    branch.
    """
    if default is None:
        return {}
    branches = [ref.name for ref in known.refs if ref.kind == "branch"]
    found = _ahead_behind(top, default) or {
        name: _counted(top, f"refs/heads/{default}", f"refs/heads/{name}")
        for name in branches
        if name != default
    }
    found.pop(default, None)
    standings_ = {name: Standing(ahead, behind, default) for name, (ahead, behind) in found.items()}
    # Counted by full names, as a tag may have a branch's name; `@{u}` takes a branch's.
    upstream = git.run(top, "rev-parse", "--symbolic-full-name", f"{default}@{{u}}")
    if upstream.returncode == 0 and (full := upstream.stdout.strip()):
        ahead, behind = _counted(top, full, f"refs/heads/{default}")
        against = full.removeprefix("refs/remotes/").removeprefix("refs/heads/")
        standings_[default] = Standing(ahead, behind, against)
    return standings_


def _ahead_behind(top: Path, default: str) -> dict[str, tuple[int, int]] | None:
    """Every local branch against `default`, in one call; None where git cannot (before 2.41)."""
    listed = git.run(
        top,
        "for-each-ref",
        f"--format=%(refname:lstrip=2)%00%(ahead-behind:refs/heads/{default})",
        "refs/heads",
    )
    if listed.returncode != 0:
        return None
    found: dict[str, tuple[int, int]] = {}
    for line in listed.stdout.splitlines():
        name, _, counts = line.partition("\0")
        ahead, behind = counts.split()
        found[changes.utf8_text(name)] = (int(ahead), int(behind))
    return found


def _counted(top: Path, base: str, branch: str) -> tuple[int, int]:
    """How far `branch` is ahead of `base`, and behind it: full names of refs, or commits."""
    counts = git.read(top, "rev-list", "--left-right", "--count", f"{base}...{branch}")
    behind, ahead = counts.split()
    return int(ahead), int(behind)


def starts(top: Path, branches: Branches, hidden: Collection[str], known: Refs) -> list[str]:
    """Where a walk of the branches starts: full ref names and commits, for `git log`.

    `local`: every local branch and the HEAD of every Checkout, detached ones too, which
    `--branches` misses. `worktrees`: the branches checked out in Checkouts, their detached
    HEADs, and the default branch. Less the branches `hidden`, checked out or not.
    """
    found = heads(top)
    # Only branches with commits: one checked out before its first (`git init`, an orphan
    # Worktree) names no commit to walk from, and git fails on it.
    existing = [ref.name for ref in known.refs if ref.kind == "branch"]
    if branches == "local":
        names = existing
    else:
        default = default_branch(top, known)
        wanted = {head.branch for head in found if head.branch is not None}
        if default:
            wanted.add(default)
        names = sorted(wanted & set(existing))
    shown = [f"refs/heads/{name}" for name in names if name not in hidden]
    detached = [head.commit for head in found if head.branch is None and head.commit]
    return [*shown, *dict.fromkeys(detached)]
