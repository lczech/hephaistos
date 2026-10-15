"""Events in short, as people read them: one line from each kind's payload.

Payloads from other versions show what fits, and the rest as stored.
"""

import json
from pathlib import Path
from typing import cast

from hephaistos.core.events.events import Event
from hephaistos.core.events.kinds import EventKind
from hephaistos.core.utils.paths import short_path
from hephaistos.core.utils.text import number_text

_MISSING = object()  # a payload field that isn't there


def payload_fields(value: object) -> dict[str, object] | None:
    """The fields of a JSON object; None for any other value."""
    return cast("dict[str, object]", value) if isinstance(value, dict) else None


def _field(payload: object, *keys: str) -> object:
    """A payload's field, through nested objects; `_MISSING` if it isn't there."""
    value = payload
    for key in keys:
        fields = payload_fields(value)
        if fields is None or key not in fields:
            return _MISSING
        value = fields[key]
    return value


def value_text(value: object) -> str:
    """A payload field as text: as it is if text, `?` if missing, else as JSON.

    So a payload from another version shows what fits, and the rest as stored.
    """
    if value is _MISSING:
        return "?"
    return value if isinstance(value, str) else json.dumps(value)


def _given(value: object) -> bool:
    """Whether an optional payload field has a value."""
    return value is not None and value is not _MISSING


def _commit_text(commit: object) -> str:
    """A commit by its short hash; `-` for none."""
    if commit is None:
        return "-"
    return commit[:7] if isinstance(commit, str) else value_text(commit)


def _path_change_text(change: object) -> str:
    """A change of path as `old → new`, the home directory as `~`."""
    old, new = _field(change, "old"), _field(change, "new")
    return " → ".join(
        short_path(Path(path)) if isinstance(path, str) else value_text(path) for path in (old, new)
    )


def summary(event: Event, width: int | None = None) -> str:
    """What an Event's payload says, in short, as `event list` and the API show it.

    Empty for kinds this version doesn't know, and where the subject says it all. A `width`
    shortens it to fit, keeping a commit's hash at the end.
    """
    try:
        kind = EventKind(event.kind)
    except ValueError:
        return ""
    fields = payload_fields(event.payload)
    if fields is None:
        text, ending = value_text(event.payload), ""
    else:
        text, ending = _summary(kind, fields), _ending(kind, fields)
    if width is not None and len(text) + len(ending) > width:
        text = f"{text[: max(width - len(ending) - 1, 0)]}…"
    return text + ending


def _ending(kind: EventKind, payload: dict[str, object]) -> str:
    """What a summary keeps when shortened: a commit's hash, and how it was made if unusual."""
    if kind not in {EventKind.CLONE_COMMITTED, EventKind.WORKTREE_COMMITTED}:
        return ""
    commit, how = _commit_text(_field(payload, "head", "new")), _field(payload, "how")
    return f" ({commit})" if how == "commit" else f" ({commit}, {value_text(how)})"


def details(event: Event) -> list[tuple[str, str]]:
    """An Event's payload as text, field by field, as `event show` shows it."""
    fields = payload_fields(event.payload)
    if fields is None:  # e.g. from another version: shown whole
        return [("payload", value_text(event.payload))]
    return [(key, payload_text(value)) for key, value in fields.items()]


def _summary(kind: EventKind, payload: dict[str, object]) -> str:  # noqa: C901, PLR0911, PLR0912 - one case per kind
    """`summary` for a kind this version knows; fields that don't fit show as stored."""

    def field(*keys: str) -> object:
        return _field(payload, *keys)

    # Exhaustive: the type checker reports a new kind missing here.
    match kind:
        case (
            EventKind.FILESYSTEM_ADDED
            | EventKind.REPOSITORY_ADDED
            | EventKind.REPOSITORY_DELETED
            | EventKind.CLONE_ADDED
            | EventKind.CLONE_DELETED
            | EventKind.CLONE_MISSING
            | EventKind.CLONE_FOUND
            | EventKind.CLONE_RECOVERED
            | EventKind.WORKTREE_MISSING
            | EventKind.WORKTREE_FOUND
            | EventKind.WORKTREE_RECOVERED
        ):
            return ""
        case EventKind.MACHINE_ADDED:
            return value_text(field("hostname"))
        case EventKind.MOUNT_ADDED:
            return value_text(field("path"))
        case (
            EventKind.MACHINE_CHANGED
            | EventKind.REPOSITORY_CHANGED
            | EventKind.CLONE_REMOTES_CHANGED
        ):
            return ", ".join(f"{name}: {payload_text(value)}" for name, value in payload.items())
        case EventKind.CLONE_FAILED | EventKind.WORKTREE_FAILED:
            return value_text(field("error"))
        case EventKind.CLONE_BRANCH_CREATED:
            start = field("start")
            return value_text(field("branch")) + (
                f" from {_commit_text(start)}" if _given(start) else ""
            )
        case EventKind.CLONE_BRANCH_DELETED:
            return value_text(field("branch"))
        case (
            EventKind.CLONE_BRANCH_RENAMED
            | EventKind.CLONE_BRANCH_SWITCHED
            | EventKind.WORKTREE_BRANCH_SWITCHED
        ):
            return payload_text(field("branch"))
        case EventKind.WORKTREE_ADDED | EventKind.WORKTREE_REMOVED | EventKind.WORKTREE_RESTORED:
            branch = field("branch")
            return "(detached)" if branch is None else value_text(branch)
        case EventKind.WORKTREE_MOVED:
            return _path_change_text(field("path"))
        case EventKind.CLONE_MOVED:
            display = field("display_path")
            return _path_change_text(display if _given(display) else field("resolved_path"))
        case EventKind.CLONE_COMMITTED | EventKind.WORKTREE_COMMITTED:
            return value_text(field("subject"))  # the hash and how: `_ending`
        case EventKind.CLONE_MERGED | EventKind.WORKTREE_MERGED:
            source = field("source")
            merged = value_text(source) if _given(source) else _commit_text(field("head", "new"))
            return merged + (" (fast-forward)" if field("fast_forward") is True else "")
        case EventKind.CLONE_PULLED | EventKind.WORKTREE_PULLED:
            return f"{value_text(field('how'))} to {_commit_text(field('head', 'new'))}"
        case EventKind.CLONE_REBASED | EventKind.WORKTREE_REBASED:
            commits, onto = field("commits"), field("onto")
            text = (
                number_text(commits, "commit")
                if isinstance(commits, int)
                else f"{value_text(commits)} commits"
            )
            return text + (f" onto {_commit_text(onto)}" if _given(onto) else "")
        case EventKind.CLONE_RESET | EventKind.WORKTREE_RESET:
            return f"to {value_text(field('target'))}"
        case EventKind.CLONE_HEAD_MOVED | EventKind.WORKTREE_HEAD_MOVED:
            return value_text(field("message"))
        case EventKind.CLONE_PUSHED:
            return f"{value_text(field('branch'))} {_commit_text(field('commit', 'new'))}"


def payload_text(value: object) -> str:
    """A payload value as text; a change as `old → new`."""
    fields = payload_fields(value)
    if fields is not None and set(fields) == {"old", "new"}:
        return f"{payload_text(fields['old'])} → {payload_text(fields['new'])}"
    return value_text(value)
