"""What Clones and Worktrees share: their status, and how they can go missing or fail."""

import uuid
from dataclasses import dataclass
from enum import StrEnum
from typing import TypedDict

from hephaistos.core.utils.git import Status
from hephaistos.core.utils.ids import Timestamp


@dataclass(frozen=True)
class Missing:
    """The Checkout's path is gone, or no longer the top of a git repository."""


@dataclass(frozen=True)
class Failed:
    """git failed on the Checkout; also the payload of a `.failed` Event."""

    error: str


@dataclass(frozen=True, kw_only=True)
class CheckoutState:
    """What was last observed about a Checkout; when missing or failed, the rest is last known."""

    observed_at: Timestamp
    observed_by: uuid.UUID
    present: bool
    error: str | None
    head: str | None
    branch: str | None
    # None when there is no working tree (bare); ahead and behind also without upstream.
    upstream: str | None
    ahead: int | None
    behind: int | None
    staged: int | None
    changed: int | None
    untracked: int | None
    conflicted: int | None


class StatusValues(TypedDict):
    """The status fields of a CheckoutState."""

    upstream: str | None
    ahead: int | None
    behind: int | None
    staged: int | None
    changed: int | None
    untracked: int | None
    conflicted: int | None


STATUS_COLUMNS = tuple(StatusValues.__annotations__)


def status_values(status: Status | None) -> StatusValues:
    """The status fields for a git status; all None without one (bare)."""
    if status is None:
        return StatusValues(
            upstream=None,
            ahead=None,
            behind=None,
            staged=None,
            changed=None,
            untracked=None,
            conflicted=None,
        )
    return {
        "upstream": status.upstream,
        "ahead": status.ahead,
        "behind": status.behind,
        "staged": status.staged,
        "changed": status.changed,
        "untracked": status.untracked,
        "conflicted": status.conflicted,
    }


class Condition(StrEnum):
    """A change in whether a Checkout can be observed; Event kinds end with these."""

    MISSING = "missing"
    FOUND = "found"
    FAILED = "failed"
    RECOVERED = "recovered"


def _health(state: CheckoutState) -> Condition | None:
    """MISSING or FAILED if the Checkout is in that condition, else None."""
    if not state.present:
        return Condition.MISSING
    return Condition.FAILED if state.error is not None else None


def conditions(old: CheckoutState, new: CheckoutState) -> list[tuple[Condition, object]]:
    """The conditions entered between two observations, with their payloads."""
    before, after = _health(old), _health(new)
    if before is after:
        return []
    if after is Condition.MISSING:
        return [(Condition.MISSING, {})]
    entered: list[tuple[Condition, object]] = []
    if before is Condition.MISSING:
        entered.append((Condition.FOUND, {}))
    if after is Condition.FAILED:
        entered.append((Condition.FAILED, Failed(new.error or "")))
    elif before is Condition.FAILED:
        entered.append((Condition.RECOVERED, {}))
    return entered
