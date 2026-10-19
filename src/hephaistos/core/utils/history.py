"""A Checkout's commits, as `git log` walks them back from a commit; nothing is stored.

A path's history goes on past renames of a file: where it ends, the oldest commit is checked
for having renamed it, and the walk continues with the path before. A search keeps the commits
whose message has all of its words, in any order and case.
"""

import re
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
_EVERYWHERE = ("--branches", "--remotes", "--tags")  # `--all` would add stashes and notes
_HASH = re.compile(r"[0-9a-fA-F]{4,40}")


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
    """A branch, remote-tracking branch or tag, by its short and full names, and its commit."""

    name: str  # `main`, `origin/main`, `v1.0`: to show
    full: str  # `refs/heads/main`: to name it, never mistaken for another ref or a Revision
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
    """Where the next page goes on: from a commit, skipping some, for a path or all.

    From every branch, remote-tracking branch and tag, and HEAD, without a commit.
    """

    start: str | None
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
        if kind_name := _kind_name(name):
            found.append(Ref(kind_name[1], changes.utf8_text(name), kind_name[0], peeled or target))
    found.sort(key=lambda ref: [kind for _, kind in _KINDS].index(ref.kind))  # stable: by date
    return Refs(
        head.stdout.strip() if head.returncode == 0 else None,
        branch.stdout.strip() if branch.returncode == 0 and head.returncode == 0 else None,
        tuple(found),
    )


def _kind_name(name: str) -> tuple[RefKind, str] | None:
    """A ref's kind and short name, by its full name; None for others, e.g. a stash."""
    for prefix, kind in _KINDS:
        if name.startswith(prefix):
            return kind, changes.utf8_text(name.removeprefix(prefix))
    return None


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


def _matching(search: str | None) -> list[str]:
    """`git log`'s options keeping the commits whose message has each word of `search`."""
    words = search.split() if search else []
    if not words:
        return []
    options = ["--regexp-ignore-case", "--fixed-strings", "--all-match"]
    return options + [f"--grep={word}" for word in words]


def _starts(walk: Next, known: Refs) -> list[str]:
    """Where `git log` walks from: a commit, or all branches and tags, and HEAD."""
    if walk.start is not None:
        return ["--end-of-options", walk.start]
    return [*_EVERYWHERE, "--end-of-options", *([known.head] if known.head else [])]


def _log(top: Path, walk: Next, count: int, known: Refs, matching: list[str]) -> list[Commit]:
    """Up to `count` commits of a walk, of those `matching` keeps."""
    output = git.read(
        top,
        "--literal-pathspecs",
        *_LOG,
        *matching,
        f"--skip={walk.skip}",
        f"--max-count={count}",
        *_starts(walk, known),
        *changes.pathspec_for(walk.path),
    )
    return _commits(output, known)


def _oldest(
    top: Path, walk: Next, page: list[Commit], matching: list[str], known: Refs
) -> tuple[str, ...]:
    """The oldest commit of a path's walk, with its parents; () if none.

    Its last page ends with it, unless a search left it out.
    """
    if not matching:
        return (page[-1].hash, *page[-1].parents) if page else ()
    listed = git.read(
        top,
        "--literal-pathspecs",
        "log",
        "--format=%H %P",  # its own parents, which `rev-list --parents` would rewrite
        *_starts(walk, known),
        *changes.pathspec_for(walk.path),
    )
    return tuple(listed.splitlines()[-1].split()) if listed else ()


def _renamed_from(top: Path, commit: tuple[str, ...], path: str) -> str | None:
    """The path that a commit (with its parents) renamed to `path`, against its first one."""
    if len(commit) < 2:  # noqa: PLR2004 - the commit and a parent
        return None
    return changes.renamed_from(top, commit[1], commit[0], path)


def _start(top: Path, ref: str | None) -> str | None:
    """The commit a ref names, or HEAD's; None before the first; raises for an unknown ref."""
    result = git.run(
        top, "rev-parse", "--verify", "--quiet", "--end-of-options", f"{ref or 'HEAD'}^{{commit}}"
    )
    if result.returncode == 0:
        return result.stdout.strip()
    if ref is None:
        return None  # no commits yet
    raise HistoryError(f"{ref!r} is not a branch, tag or commit here")


def history(  # noqa: PLR0913 - the optional ones are keyword-only
    top: Path,
    ref: str | None = None,
    path: str | None = None,
    *,
    search: str | None = None,
    everywhere: bool = False,
    after: Next | None = None,
    limit: int,
) -> History:
    """Up to `limit` commits of the Checkout at `top`, from `ref` (or HEAD) back.

    Or, `everywhere`, from all branches, remote-tracking branches and tags. In `git log`'s
    order; only those that changed `path`, if given, following a file's renames, and whose
    message has the words of `search`. `after` goes on where a page ended, for the same search.
    """
    if everywhere and ref is not None:
        raise HistoryError("give a ref or everywhere, not both")
    known = refs(top)
    if after is None:
        if everywhere:
            if known.head is None and not known.refs:
                return History((), None)
            after = Next(None, path, 0)
        else:
            start = _start(top, ref)
            if start is None:
                return History((), None)
            after = Next(start, path, 0)
    changes.pathspec_for(after.path)  # checked before git runs
    matching = _matching(search)
    found: list[Commit] = []
    walk: Next | None = after
    while walk is not None and len(found) < limit:
        wanted = limit - len(found)
        page = _log(top, walk, wanted + 1, known, matching)
        found += page[:wanted]
        if len(page) > wanted:
            walk = replace(walk, skip=walk.skip + wanted)
        elif (
            walk.path is not None
            and (oldest := _oldest(top, walk, page, matching, known))
            and (old := _renamed_from(top, oldest, walk.path))
        ):
            if page and page[-1].hash == oldest[0]:
                found[-1] = replace(found[-1], renamed_from=old)
            walk = Next(oldest[1], old, 0)
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


def _read(top: Path, name: str, known: Refs) -> Commit | None:
    """The commit `name` resolves to; None if none."""
    result = git.run(top, *_LOG, "--max-count=1", "--end-of-options", f"{name}^{{commit}}", "--")
    if result.returncode != 0 or not result.stdout:
        return None
    return _commits(result.stdout, known)[0]


def _ancestor(top: Path, commit: str, of: str | None) -> bool:
    """Whether `of` leads to `commit`, or is it."""
    return of is not None and (
        git.run(top, "merge-base", "--is-ancestor", commit, of).returncode == 0
    )


def _leading(top: Path, commit: str, known: Refs, *, count: int | None = None) -> tuple[Ref, ...]:
    """The branches, remote-tracking branches and tags leading to a commit, up to `count`.

    In the order `refs` has them. Slow in a large repository without git's commit-graph file.
    """
    listed = git.read(
        top,
        "for-each-ref",
        *([] if count is None else [f"--count={count}"]),
        "--format=%(refname)",
        f"--contains={commit}",
        *(prefix for prefix, _ in _KINDS),
    )
    names = {changes.utf8_text(name) for name in listed.splitlines()}
    return tuple(ref for ref in known.refs if ref.full in names)


def commit(top: Path, name: str) -> Shown:
    """The commit `name` resolves to in the Checkout at `top`."""
    known = refs(top)
    found = _read(top, name, known)
    if found is None:
        return Shown(None, reachable=False)
    reachable = _ancestor(top, found.hash, known.head) or bool(
        _leading(top, found.hash, known, count=1)
    )
    return Shown(found, reachable=reachable)


type Where = Literal["listed", "path", "refs", "none"]


@dataclass(frozen=True)
class Found:
    """The commit a search names by its hash, and where it is, against the commits searched.

    `listed` among them; `path` where they walk, but not changing their path (by its name
    there); `refs` only on other branches or tags, which `refs` gives; `none` if nothing leads
    to it any more: amended, rebased or reset away.
    """

    commit: Commit
    where: Where
    refs: tuple[Ref, ...] = ()


def _changes_path(top: Path, commit: str, path: str) -> bool:
    """Whether a commit changed a file or folder, against its first parent."""
    base, target = changes.commit_revisions(top, commit)
    result = git.run(
        top,
        "--literal-pathspecs",
        "diff",
        "--quiet",
        "--no-ext-diff",
        base,
        target,
        *changes.pathspec_for(path),
    )
    return result.returncode == 1


def by_hash(
    top: Path,
    search: str | None,
    ref: str | None = None,
    path: str | None = None,
    *,
    everywhere: bool = False,
) -> Found | None:
    """The commit whose hash starts with `search`, if that is one word of 4 to 40 hex digits.

    Where it is, against the commits `history` walks with the same `ref`, `path` and
    `everywhere`. None if no commit, or several, have such a hash.
    """
    words = search.split() if search else []
    if len(words) != 1 or not _HASH.fullmatch(words[0]):
        return None
    prefix = words[0].lower()
    known = refs(top)
    found = _read(top, prefix, known)
    if found is None or not found.hash.startswith(prefix):  # none, or a branch of that name
        return None
    if everywhere:
        walked = _ancestor(top, found.hash, known.head) or bool(
            _leading(top, found.hash, known, count=1)
        )
    else:
        walked = _ancestor(top, found.hash, _start(top, ref))
    if walked:
        listed = path is None or _changes_path(top, found.hash, path)
        return Found(found, "listed" if listed else "path")
    leading = _leading(top, found.hash, known)
    return Found(found, "refs" if leading else "none", leading)
