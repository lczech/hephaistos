"""Git activity: what was done in a Checkout, read from its reflogs since a cursor.

Reflog messages are git's own text, stable in practice but not specified; what this module
can't name becomes `head_moved` with the message.
"""

import hashlib
import re
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Self

from hephaistos.core.events.events import Change
from hephaistos.core.utils.git import ReflogEntry


@dataclass(frozen=True)
class Cursor:
    """Where reading a reflog stopped: the last entry read, by its time and digest."""

    seconds: int
    digest: str  # empty before the first entry

    def to_text(self) -> str:
        """The cursor as stored."""
        return f"{self.seconds} {self.digest}"

    @classmethod
    def from_text(cls, text: str) -> Self:
        """A cursor as stored."""
        seconds, _, digest = text.partition(" ")
        return cls(int(seconds), digest)


BEGINNING = Cursor(0, "")


def _digest(entry: ReflogEntry) -> str:
    """What tells reflog entries apart, short of git's position, which expiry changes."""
    text = f"{entry.ref}\0{entry.at.isoformat()}\0{entry.new}\0{entry.message}"
    return hashlib.sha256(text.encode(errors="surrogateescape")).hexdigest()[:16]


def cursor_after(entry: ReflogEntry) -> Cursor:
    """The cursor after reading `entry`."""
    return Cursor(int(entry.at.timestamp()), _digest(entry))


def end(entries: Sequence[ReflogEntry]) -> Cursor:
    """The cursor after all of a reflog's entries, newest first."""
    return cursor_after(entries[0]) if entries else BEGINNING


def unread(entries: Sequence[ReflogEntry], cursor: Cursor) -> list[ReflogEntry] | None:
    """The entries (newest first) after `cursor`, oldest first; None if it isn't among them."""
    for index, entry in enumerate(entries):
        if _digest(entry) == cursor.digest:
            return list(reversed(entries[:index]))
    return None


def newer(entries: Sequence[ReflogEntry], cursor: Cursor) -> list[ReflogEntry]:
    """The entries (newest first) after the cursor's time, oldest first.

    For when the cursor's own entry is gone, e.g. expired.
    """
    return [entry for entry in reversed(entries) if entry.at.timestamp() > cursor.seconds]


class ActivityKind(StrEnum):
    """What was done in a Checkout; Event kinds end with these."""

    COMMITTED = "committed"
    MERGED = "merged"
    PULLED = "pulled"
    REBASED = "rebased"
    RESET = "reset"
    BRANCH_SWITCHED = "branch_switched"
    HEAD_MOVED = "head_moved"


@dataclass(frozen=True)
class ActivityPayload:
    """What the payloads of git activity share: where HEAD moved."""

    head: Change  # old is None if unknown


@dataclass(frozen=True)
class CommittedPayload(ActivityPayload):
    """The payload of `committed`."""

    subject: str
    how: str  # commit, initial, amend, cherry-pick, revert or am
    amends: str | None  # the commit an amend replaced


@dataclass(frozen=True)
class MergedPayload(ActivityPayload):
    """The payload of `merged`."""

    source: str | None  # None when committed after resolving conflicts
    fast_forward: bool


@dataclass(frozen=True)
class PulledPayload(ActivityPayload):
    """The payload of `pulled`."""

    how: str  # fast-forward, merge or rebase
    arguments: str  # as given to `git pull`


@dataclass(frozen=True)
class RebasedPayload(ActivityPayload):
    """The payload of `rebased`."""

    onto: str | None
    commits: int  # picked, reworded, squashed, …
    branch: str | None  # None if detached


@dataclass(frozen=True)
class ResetPayload(ActivityPayload):
    """The payload of `reset`."""

    target: str  # as given, e.g. `HEAD~1`


@dataclass(frozen=True)
class SwitchedPayload(ActivityPayload):
    """The payload of `branch_switched`: branch names, or commits when detached."""

    branch: Change


@dataclass(frozen=True)
class HeadMovedPayload(ActivityPayload):
    """The payload of `head_moved`: git's message, where we don't know its kind."""

    message: str


@dataclass(frozen=True)
class Activity:
    """One thing done in a Checkout, as an Event's kind, time (git's) and payload."""

    kind: ActivityKind
    occurred_at: datetime
    payload: ActivityPayload


_RUN_STEP = re.compile(
    r"(?P<action>[^:]*\brebase\b[^:]*?) \((?P<step>[a-z-]+)\)(?:: (?P<detail>.*))?"
)
_RUN_ENDS = frozenset({"finish", "abort"})
_NOT_COMMITS = frozenset({"start", "finish", "abort", "reset", "label", "update-ref"})
_COMMIT = re.compile(
    r"(?P<how>commit|cherry-pick|revert|am)(?: \((?P<variant>[a-z-]+)\))?: (?P<subject>.*)"
)
_MERGE = re.compile(r"merge (?P<source>.+?): (?P<result>.*)")
_PULL = re.compile(r"pull(?P<arguments>(?: [^:]*)?): (?P<result>.*)")
_RESET = re.compile(r"reset: moving to (?P<target>.*)")
_SWITCH = re.compile(r"checkout: moving from (?P<old>.*) to (?P<new>.*)")
# Renaming a branch is a Clone's Event; a new Worktree's first entry has no message.
_SKIPPED = re.compile(r"Branch: renamed .*|")
_FAST_FORWARD = "Fast-forward"


def _head(entry: ReflogEntry) -> Change:
    return Change(entry.old, entry.new)


def _single(entry: ReflogEntry) -> list[Activity]:  # noqa: PLR0911 - one return per message
    """The activity of one entry outside a rebase."""
    at, head = entry.at, _head(entry)
    if match := _COMMIT.fullmatch(entry.message):
        how, variant = match["how"], match["variant"]
        if how == "commit" and variant == "merge":
            return [
                Activity(ActivityKind.MERGED, at, MergedPayload(head, None, fast_forward=False))
            ]
        if how == "commit" and variant:
            how = variant
        amends = entry.old if how == "amend" else None
        payload = CommittedPayload(head, match["subject"], how, amends)
        return [Activity(ActivityKind.COMMITTED, at, payload)]
    if match := _MERGE.fullmatch(entry.message):
        fast = match["result"] == _FAST_FORWARD
        return [Activity(ActivityKind.MERGED, at, MergedPayload(head, match["source"], fast))]
    if match := _PULL.fullmatch(entry.message):
        how = "fast-forward" if match["result"] == _FAST_FORWARD else "merge"
        payload = PulledPayload(head, how, match["arguments"].strip())
        return [Activity(ActivityKind.PULLED, at, payload)]
    if match := _RESET.fullmatch(entry.message):
        if entry.old == entry.new:  # e.g. by `git stash`
            return []
        return [Activity(ActivityKind.RESET, at, ResetPayload(head, match["target"]))]
    if match := _SWITCH.fullmatch(entry.message):
        payload = SwitchedPayload(head, Change(match["old"], match["new"]))
        return [Activity(ActivityKind.BRANCH_SWITCHED, at, payload)]
    if _SKIPPED.fullmatch(entry.message):
        return []
    return [Activity(ActivityKind.HEAD_MOVED, at, HeadMovedPayload(head, entry.message))]


def _run(entries: Sequence[ReflogEntry]) -> list[Activity]:
    """The activity of a rebase's entries, from its start to its end: one, if HEAD moved."""
    first, last = entries[0], entries[-1]
    head = Change(first.old, last.new)
    if first.old == last.new:
        return []
    start = _RUN_STEP.fullmatch(first.message)
    end = _RUN_STEP.fullmatch(last.message)
    if start is None or end is None:
        raise ValueError("a run starts and ends with rebase steps")
    if end["step"] == "abort":
        return [Activity(ActivityKind.HEAD_MOVED, last.at, HeadMovedPayload(head, last.message))]
    action = start["action"]
    if action == "pull" or action.startswith("pull "):
        arguments = action.removeprefix("pull").strip()
        return [Activity(ActivityKind.PULLED, last.at, PulledPayload(head, "rebase", arguments))]
    detail = end["detail"] or ""
    branch = (
        detail.removeprefix("returning to refs/heads/")
        if end["step"] == "finish" and detail.startswith("returning to refs/heads/")
        else None
    )
    commits = sum(
        1
        for entry in entries
        if (step := _RUN_STEP.fullmatch(entry.message)) and step["step"] not in _NOT_COMMITS
    )
    onto = first.new if start["step"] == "start" else None
    return [Activity(ActivityKind.REBASED, last.at, RebasedPayload(head, onto, commits, branch))]


def _run_end(entries: Sequence[ReflogEntry], start: int) -> tuple[int, bool]:
    """The index of the last entry of the rebase starting at `start`, and whether it is over.

    It is over at its finish or abort, or once another rebase starts: `git rebase --quit`
    leaves no entry. Otherwise it ends with its last step so far.
    """
    last = start
    for index in range(start, len(entries)):
        step = _RUN_STEP.fullmatch(entries[index].message)
        if step is None:
            continue  # e.g. an amend while the rebase stopped to edit
        if step["step"] in _RUN_ENDS:
            return index, True
        if step["step"] == "start" and index > start:
            return last, True
        last = index
    return last, False


def activities(entries: Sequence[ReflogEntry], *, rebasing: bool) -> tuple[list[Activity], int]:
    """The activity in a HEAD reflog's entries (oldest first), and how many entries it covers.

    A rebase folds into one Activity. While one is in progress, it is left for later: the
    count stops before its start. One without an end otherwise ends with its last step.
    """
    found: list[Activity] = []
    index = 0
    while index < len(entries):
        if not _RUN_STEP.fullmatch(entries[index].message):
            found += _single(entries[index])
            index += 1
            continue
        end, over = _run_end(entries, index)
        if not over and rebasing:
            return found, index
        found += _run(entries[index : end + 1])
        index = end + 1
    return found, len(entries)


@dataclass(frozen=True)
class PushedPayload:
    """The payload of `clone.pushed`."""

    branch: str  # the remote-tracking branch, e.g. `origin/main`
    commit: Change


@dataclass(frozen=True)
class Push:
    """A push, with git's time."""

    occurred_at: datetime
    payload: PushedPayload


_PUSHED = "update by push"


def pushes(entries: Sequence[ReflogEntry]) -> list[Push]:
    """The pushes among remote-tracking reflog entries, in their order; fetches are skipped."""
    return [
        Push(
            entry.at,
            PushedPayload(entry.ref.removeprefix("refs/remotes/"), Change(entry.old, entry.new)),
        )
        for entry in entries
        if entry.message == _PUSHED
    ]


@dataclass(frozen=True)
class BranchOrigin:
    """Where a branch came from, by its reflog; all None if it has none."""

    created_at: datetime | None
    start: str | None  # the commit it was created at
    renamed_from: str | None  # its previous name, if renamed last
    renamed_at: datetime | None


UNKNOWN_ORIGIN = BranchOrigin(None, None, None, None)


def branch_origin(branch: str, entries: Sequence[ReflogEntry]) -> BranchOrigin:
    """Where `branch` came from, by its reflog's entries, newest first."""
    if not entries:
        return UNKNOWN_ORIGIN
    created = entries[-1]
    renamed = re.compile(
        rf"Branch: renamed refs/heads/(?P<old>.+) to refs/heads/{re.escape(branch)}"
    )
    for entry in entries:
        if match := renamed.fullmatch(entry.message):
            return BranchOrigin(created.at, created.new, match["old"], entry.at)
    return BranchOrigin(created.at, created.new, None, None)


@dataclass(frozen=True)
class CheckoutActivity:
    """What reading a Checkout's HEAD reflog gave: its activity, and where reading stopped."""

    activities: Sequence[Activity]
    cursor: Cursor


@dataclass(frozen=True)
class CloneActivity(CheckoutActivity):
    """A Clone's activity: also its pushes and where its branches came from."""

    pushes: Sequence[Push]
    push_cursors: Mapping[str, Cursor]  # by remote-tracking ref
    origins: Mapping[str, BranchOrigin]  # of new branches


def key(clone_id: uuid.UUID, checkout: str, ref: str, at: datetime, moved: Change) -> bytes:
    """What identifies a change that a reflog recorded, whichever Machine read it.

    `checkout` is the Worktree's name, empty for the Clone itself; `moved` is what changed,
    usually the commit.
    """
    parts = [str(clone_id), checkout, ref, at.isoformat(), str(moved.old or ""), str(moved.new)]
    return hashlib.sha256("\0".join(parts).encode(errors="surrogateescape")).digest()[:16]
