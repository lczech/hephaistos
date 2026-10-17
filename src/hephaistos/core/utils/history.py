"""A Checkout's commits, as `git log` walks them back from a commit; nothing is stored.

A path's history goes on past renames of a file: where it ends, the oldest commit is checked
for having renamed it, and the walk continues with the path before.
"""

from dataclasses import dataclass, replace
from datetime import datetime
from pathlib import Path
from typing import Literal

from hephaistos.core.utils import changes, git
from hephaistos.core.utils.errors import HephaistosError

type RefKind = Literal["branch", "remote", "tag"]

_KINDS: tuple[tuple[str, RefKind], ...] = (
    ("refs/heads/", "branch"),
    ("refs/remotes/", "remote"),
    ("refs/tags/", "tag"),
)
# A commit's fields, NUL apart; `-z` puts a NUL between commits too, so each has _FIELDS.
_FORMAT = "%H%x00%P%x00%aN%x00%aE%x00%aI%x00%cN%x00%cE%x00%cI%x00%s%x00%b"
_FIELDS = 10
_LOG = ("log", "--no-color", "--no-show-signature", "-z", f"--format={_FORMAT}")


class HistoryError(HephaistosError):
    """A history that can't be walked here: an unknown ref, or a path outside the Checkout."""


@dataclass(frozen=True)
class Person:
    """Who wrote or committed a commit, and when, with the offset git recorded."""

    name: str
    email: str
    at: datetime


@dataclass(frozen=True)
class Ref:
    """A branch, remote-tracking branch or tag, by its short name, and its commit."""

    name: str  # `main`, `origin/main`, `v1.0`
    kind: RefKind
    commit: str


@dataclass(frozen=True)
class Commit:
    """A commit, with the refs pointing at it."""

    hash: str
    parents: tuple[str, ...]
    subject: str
    body: str  # the message after the subject; empty for one line
    author: Person
    committer: Person
    refs: tuple[Ref, ...] = ()
    renamed_from: str | None = None  # in a file's history: its path before this commit


@dataclass(frozen=True)
class Refs:
    """Where HEAD is, and the refs to walk from instead, the most recent first in each kind."""

    head: str | None  # its commit; None before the first
    branch: str | None  # None when detached
    refs: tuple[Ref, ...]

    def at(self, commit: str) -> tuple[Ref, ...]:
        """The refs pointing at a commit."""
        return tuple(ref for ref in self.refs if ref.commit == commit)


@dataclass(frozen=True)
class Next:
    """Where the next page goes on: from a commit, skipping some, for a path or all."""

    start: str
    path: str | None
    skip: int


@dataclass(frozen=True)
class History:
    """A page of commits, newest first, and where the next goes on; None at the end."""

    commits: tuple[Commit, ...]
    next: Next | None


def refs(top: Path) -> Refs:
    """The Checkout's HEAD, branches, remote-tracking branches and tags."""
    head = git.run(top, "rev-parse", "--verify", "--quiet", "HEAD^{commit}")
    branch = git.run(top, "symbolic-ref", "--quiet", "--short", "HEAD")
    listed = git.read(
        top,
        "for-each-ref",
        "--sort=-creatordate",
        "--format=%(refname)%00%(objectname)%00%(*objectname)%00%(symref)",
        *(prefix for prefix, _ in _KINDS),
    )
    found: list[Ref] = []
    for line in listed.splitlines():
        name, target, peeled, symref = line.split("\0")
        if symref:  # `origin/HEAD`, naming another
            continue
        for prefix, kind in _KINDS:
            if name.startswith(prefix):
                short = changes.utf8_text(name.removeprefix(prefix))
                found.append(Ref(short, kind, peeled or target))
    found.sort(key=lambda ref: [kind for _, kind in _KINDS].index(ref.kind))  # stable: by date
    return Refs(
        head.stdout.strip() if head.returncode == 0 else None,
        branch.stdout.strip() if branch.returncode == 0 and head.returncode == 0 else None,
        tuple(found),
    )


def _commits(output: str, known: Refs) -> list[Commit]:
    """Parses `git log` in _FORMAT with `-z`."""
    fields = [changes.utf8_text(field) for field in output.split("\0")] if output else []
    found: list[Commit] = []
    for index in range(0, len(fields) - _FIELDS + 1, _FIELDS):
        hash_, parents, *people, subject, body = fields[index : index + _FIELDS]
        author = Person(people[0], people[1], datetime.fromisoformat(people[2]))
        committer = Person(people[3], people[4], datetime.fromisoformat(people[5]))
        found.append(
            Commit(
                hash_,
                tuple(parents.split()),
                subject,
                body.strip("\n"),
                author,
                committer,
                known.at(hash_),
            )
        )
    return found


def _log(top: Path, walk: Next, count: int, known: Refs) -> list[Commit]:
    """Up to `count` commits of a walk."""
    output = git.read(
        top,
        "--literal-pathspecs",
        *_LOG,
        f"--skip={walk.skip}",
        f"--max-count={count}",
        "--end-of-options",
        walk.start,
        *changes.pathspec_for(walk.path),
    )
    return _commits(output, known)


def _renamed_from(top: Path, commit: Commit, path: str) -> str | None:
    """The path that `commit` renamed to `path`, compared with its first parent; None if none."""
    if not commit.parents:
        return None
    return changes.renamed_from(top, commit.parents[0], commit.hash, path)


def _start(top: Path, ref: str | None) -> str | None:
    """The commit a ref names, or HEAD's; None before the first; raises for an unknown ref."""
    result = git.run(
        top, "rev-parse", "--verify", "--quiet", "--end-of-options", f"{ref or 'HEAD'}^{{commit}}"
    )
    if result.returncode == 0:
        return result.stdout.strip()
    if ref is None:
        return None  # no commits yet
    raise HistoryError(f"{ref!r} is no branch, tag or commit here")


def history(
    top: Path,
    ref: str | None = None,
    path: str | None = None,
    *,
    after: Next | None = None,
    limit: int,
) -> History:
    """Up to `limit` commits of the Checkout at `top`, from `ref` (or HEAD) back.

    In `git log`'s order; only those that changed `path`, if given, following a file's renames.
    `after` goes on where a page ended.
    """
    if after is None:
        start = _start(top, ref)
        if start is None:
            return History((), None)
        after = Next(start, path, 0)
    changes.pathspec_for(after.path)  # checked before git runs
    known = refs(top)
    found: list[Commit] = []
    walk: Next | None = after
    while walk is not None and len(found) < limit:
        wanted = limit - len(found)
        page = _log(top, walk, wanted + 1, known)
        found += page[:wanted]
        if len(page) > wanted:
            walk = replace(walk, skip=walk.skip + wanted)
        elif walk.path is not None and page and (old := _renamed_from(top, page[-1], walk.path)):
            found[-1] = replace(found[-1], renamed_from=old)
            walk = Next(page[-1].parents[0], old, 0)
        else:
            walk = None
    return History(tuple(found), walk)


@dataclass(frozen=True)
class Shown:
    """A commit asked for, if git still has it, and whether a branch, tag or HEAD leads to it.

    One that none leads to was amended, rebased or reset away.
    """

    commit: Commit | None
    reachable: bool


def commit(top: Path, name: str) -> Shown:
    """The commit `name` resolves to in the Checkout at `top`."""
    result = git.run(top, *_LOG, "--max-count=1", "--end-of-options", f"{name}^{{commit}}", "--")
    if result.returncode != 0 or not result.stdout:
        return Shown(None, reachable=False)
    known = refs(top)
    found = _commits(result.stdout, known)[0]
    contains = git.run(
        top,
        "for-each-ref",
        "--count=1",
        "--format=x",
        f"--contains={found.hash}",
        *(prefix for prefix, _ in _KINDS),
    )
    on_head = known.head is not None and (
        git.run(top, "merge-base", "--is-ancestor", found.hash, known.head).returncode == 0
    )
    return Shown(found, reachable=bool(contains.stdout.strip()) or on_head)
