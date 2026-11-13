"""Branch tips only: the graph of a walk with only the commits where something happens.

Kept are the commits a walk starts from (the tips of the branches a graph shows, the HEADs of
Checkouts), the first commits its lines end in, and each commit where lines part or join.
Lines go down first parents; the side of a merge is drawn only between two of them, so that
branches merged and gone draw nothing. Between two commits kept, a line stands for the commits
left out: those the newer has and the older has not, as ahead and behind count them, the sides
not drawn too; a commit merged into two lines may count on both. The whole walk is read at once,
in memory: hashes, parents and dates only.
"""

import heapq
from collections.abc import Collection, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from hephaistos.core.utils import git, history
from hephaistos.core.utils.history import Commit, Order


@dataclass(frozen=True)
class Between:
    """A line between a commit kept and one of its parents kept, and the commits left out on it."""

    commit: str
    parent: str  # the kept commit the line ends in
    count: int  # the commits left out: 0 where the parent is the commit's own
    newest: datetime | None  # the author date of the newest of them, in UTC; None without any
    oldest: datetime | None


@dataclass(frozen=True)
class Tips:
    """The commits kept, newest first in the order of the walk, and the lines between them.

    The lines of each commit come in the order of its parents, the first parent's first.
    """

    commits: tuple[Commit, ...]
    lines: tuple[Between, ...]


@dataclass(frozen=True)
class _Walk:
    """All commits of a walk: their place in it (children first), parents in it, and dates."""

    index: dict[str, int]
    parents: dict[str, tuple[str, ...]]
    at: dict[str, int]  # author dates, in seconds

    def first(self, commit: str) -> str | None:
        parents = self.parents[commit]
        return parents[0] if parents else None


def tips(top: Path, starts: Sequence[str], *, order: Order, keep: Collection[str] = ()) -> Tips:
    """The commits kept of the walk from `starts` in `order`, and the lines between them.

    `starts` are full ref names and commits, as `graph.starts` gives them. `keep` are commits
    kept as if the walk started from them too, where it has them: e.g. the HEAD of a Checkout on
    a hidden branch, with what is not committed above it.
    """
    if not starts:
        return Tips((), ())
    known = history.refs(top)
    walk = _walk(top, starts, order)
    by_full = {ref.full: ref.commit for ref in known.refs}
    seeds = ({by_full.get(start, start) for start in starts} | set(keep)) & walk.index.keys()
    drawn, sides = _drawn(walk, seeds)
    kept = _kept(walk, seeds, drawn, sides)
    ordered = sorted(kept, key=walk.index.__getitem__)
    lines: list[Between] = []
    for commit in ordered:
        first, *others = walk.parents[commit] or (None,)
        if first is None:
            continue
        # The sides not drawn are left out on the line of the first parent, as merged into it.
        drawn_sides = [parent for parent in others if (commit, parent) in sides]
        not_drawn = [parent for parent in others if (commit, parent) not in sides]
        lines.append(_between(walk, kept, commit, first, not_drawn))
        lines += [_between(walk, kept, commit, parent, []) for parent in drawn_sides]
    return Tips(tuple(history.commits(top, ordered, known)), tuple(lines))


def _walk(top: Path, starts: Sequence[str], order: Order) -> _Walk:
    """The walk from `starts`, as `git log` gives it in `order`: each commit after its children."""
    output = git.read(
        top,
        "log",
        "--no-color",
        "--no-show-signature",
        "--format=%H %at %P",
        "--topo-order" if order == "topo" else "--date-order",
        "--end-of-options",
        *starts,
    )
    index: dict[str, int] = {}
    parents: dict[str, tuple[str, ...]] = {}
    at: dict[str, int] = {}
    for line in output.splitlines():
        hash_, seconds, *its = line.split()
        index[hash_] = len(index)
        parents[hash_] = tuple(its)
        at[hash_] = int(seconds)
    # A shallow clone's oldest commits name parents it does not have.
    for hash_, its in parents.items():
        parents[hash_] = tuple(parent for parent in its if parent in index)
    return _Walk(index, parents, at)


def _drawn(walk: _Walk, seeds: set[str]) -> tuple[set[str], set[tuple[str, str]]]:
    """The commits lines pass, kept or not, and the sides of merges drawn, as (merge, parent).

    Lines go down the first parents of each seed. The side of a merge on them is drawn where its
    parent is on one of them too: a branch still there merged, or the default branch merged into
    one. That of a branch merged and gone has commits of its own, on no line: it draws nothing.
    """
    drawn: set[str] = set()
    for seed in sorted(seeds, key=walk.index.__getitem__):
        commit: str | None = seed
        while commit is not None and commit not in drawn:
            drawn.add(commit)
            commit = walk.first(commit)
    sides = {
        (merge, parent) for merge in drawn for parent in walk.parents[merge][1:] if parent in drawn
    }
    return drawn, sides


def _kept(walk: _Walk, seeds: set[str], drawn: set[str], sides: set[tuple[str, str]]) -> set[str]:
    """The seeds, the first commits lines end in, and where lines drawn part or join."""
    children: dict[str, int] = {}
    for commit in drawn:
        if (first := walk.first(commit)) is not None:
            children[first] = children.get(first, 0) + 1
    for _, parent in sides:
        children[parent] = children.get(parent, 0) + 1
    return (
        seeds
        | {commit for commit in drawn if walk.first(commit) is None}
        | {merge for merge, _ in sides}
        | {commit for commit, count in children.items() if count > 1}
    )


def _between(walk: _Walk, kept: set[str], commit: str, start: str, merged: list[str]) -> Between:
    """The line from `commit` through its parent `start`, down first parents to a commit kept.

    The commits left out on it are those `start` and the sides `merged` there have, and the commit
    it ends in has not.
    """
    end = start
    while end not in kept:
        end = walk.parents[end][0]  # one not kept has a parent: the first commits are kept
    left_out = _only_in(walk, [start, *merged], end)
    if not left_out:
        return Between(commit, end, 0, None, None)
    dates = [walk.at[each] for each in left_out]
    return Between(commit, end, len(left_out), _date(max(dates)), _date(min(dates)))


def _only_in(walk: _Walk, starts: list[str], end: str) -> list[str]:
    """The commits `starts` have and `end` has not, `starts` with them unless `end` has them.

    All walked down at once, children before parents, as the walk lists them: a commit is taken
    once all that lead to it came, and the walk stops once only `end` leads to what is left.
    """
    mine, theirs = 1, 2
    marks = dict.fromkeys(starts, mine)
    marks[end] = theirs if end not in marks else mine | theirs
    queue = [(walk.index[commit], commit) for commit in marks]
    heapq.heapify(queue)
    left = sum(mark == mine for mark in marks.values())  # queued, led to by `starts` only
    found: list[str] = []
    while left:
        _, commit = heapq.heappop(queue)
        mark = marks[commit]
        if mark == mine:
            left -= 1
            found.append(commit)
        for parent in walk.parents[commit]:
            before = marks.get(parent)
            after = (before or 0) | mark
            if before == after:
                continue
            marks[parent] = after
            if before is None:
                heapq.heappush(queue, (walk.index[parent], parent))
                left += after == mine
            elif before == mine:
                left -= 1  # now led to by `end` too
    return found


def _date(seconds: int) -> datetime:
    return datetime.fromtimestamp(seconds, UTC)
