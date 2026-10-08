import json
import re
import uuid
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated, Any, Literal

import typer

from hephaistos.cli.output import (
    JsonOption,
    LimitOption,
    TimeFormatOption,
    number_text,
    print_fields,
    print_json,
    print_table,
    short_path,
    time_formatter,
)
from hephaistos.cli.worktree import find_worktree
from hephaistos.core.config import TimeFormat
from hephaistos.core.db.sessions import ReadSession, read_session
from hephaistos.core.events import events, subjects
from hephaistos.core.events.events import Event
from hephaistos.core.events.kinds import EventKind, Priority
from hephaistos.core.events.subjects import Label
from hephaistos.core.registry import clones, machines, repositories
from hephaistos.core.utils.ids import short_id
from hephaistos.core.utils.paths import Paths

app = typer.Typer(no_args_is_help=True, help="Events: what happened, on any Machine.")

PriorityName = Literal["low", "normal", "high", "urgent"]

KindOption = Annotated[
    list[str] | None,
    typer.Option(
        "--kind",
        "-k",
        help="Only this kind, or kinds starting with it (`clone`), or a glob (`'*.deleted'`)."
        " Repeat for several.",
    ),
]
PriorityOption = Annotated[
    PriorityName | None, typer.Option("--priority", "-p", help="Only this priority or higher.")
]
MachineOption = Annotated[
    str | None, typer.Option("--machine", "-m", help="Only Events recorded by this Machine.")
]
SinceOption = Annotated[
    str | None,
    typer.Option("--since", "-s", help="Only Events since then: `30m`, `2h`, `3d`, or a date."),
]
RepoFilterOption = Annotated[
    str | None,
    typer.Option(
        "--repo", "-r", help="Only Events about this Repository, its Clones and their Worktrees."
    ),
]
CloneFilterOption = Annotated[
    Path | None,
    typer.Option(
        "--clone",
        help="Only Events about the Clone that this path lies in, also through one of its"
        " Worktrees, and about its Worktrees.",
    ),
]
WorktreeFilterOption = Annotated[
    str | None,
    typer.Option("--worktree", help="Only Events about this Worktree: a path in it, or its name."),
]

_UNIT_SECONDS = {"s": 1, "m": 60, "h": 60 * 60, "d": 24 * 60 * 60}
_DURATION = re.compile(r"(\d+)([smhd])")


def parse_since(value: str, now: datetime) -> datetime:
    """A duration before `now` (`2h`), or a date or time in ISO form, local unless it says."""
    if match := _DURATION.fullmatch(value):
        return now - timedelta(seconds=int(match[1]) * _UNIT_SECONDS[match[2]])
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        raise typer.BadParameter(
            f"{value!r} is neither a duration like 2h nor a date like 2026-10-05",
            param_hint="--since",
        ) from None
    return parsed if parsed.tzinfo else parsed.astimezone()


def _priority_text(value: int) -> str:
    """A priority by name, or as a number if this version doesn't know it."""
    try:
        return Priority(value).name.lower()
    except ValueError:
        return str(value)


def _subject_text(event: Event, labels: Mapping[uuid.UUID, Label]) -> str:
    """The Event's subject as shown: its label, else its short ID."""
    label = labels.get(event.subject)
    if label is None:
        return short_id(event.subject)
    return short_path(label) if isinstance(label, Path) else label


def _machine_text(event: Event, names: Mapping[uuid.UUID, str]) -> str:
    """The name of the Machine that recorded the Event, else its short ID."""
    return names.get(event.recorded_by) or short_id(event.recorded_by)


def _event_json(
    event: Event, labels: Mapping[uuid.UUID, Label], names: Mapping[uuid.UUID, str]
) -> dict[str, object]:
    """An Event for JSON output, with the names of its subject and Machine where known."""
    label = labels.get(event.subject)
    return {
        "id": str(event.id),
        "recorded_at": event.recorded_at.datetime.isoformat(),
        "recorded_by": str(event.recorded_by),
        "occurred_at": None if event.occurred_at is None else event.occurred_at.isoformat(),
        "machine": names.get(event.recorded_by),
        "priority": event.priority,
        "kind": event.kind,
        "subject": str(event.subject),
        "subject_label": None if label is None else str(label),
        "payload": event.payload,
        "key": None if event.key is None else event.key.hex(),
    }


@app.command("list")
def list_(  # noqa: PLR0913 - one option per filter
    *,
    kind: KindOption = None,
    priority: PriorityOption = None,
    machine: MachineOption = None,
    since: SinceOption = None,
    repo: RepoFilterOption = None,
    clone: CloneFilterOption = None,
    worktree: WorktreeFilterOption = None,
    limit: LimitOption = 20,
    time_format: TimeFormatOption = None,
    as_json: JsonOption = False,
) -> None:
    """List Events, newest first."""
    since_time = parse_since(since, datetime.now(UTC)) if since else None
    with read_session(Paths.from_environment()) as session:
        found = events.recent(
            session,
            limit=limit or None,
            kinds=kind or (),
            min_priority=Priority[priority.upper()] if priority else None,
            recorded_by=machines.by_name(session, machine).id if machine else None,
            since=since_time,
            repository_id=repositories.by_name(session, repo).id if repo else None,
            clone_id=clones.find_unobserved(session, clone).clone.id if clone else None,
            worktree_id=find_worktree(session, worktree)[0].id if worktree else None,
        )
        print_events(session, found, time_format=time_format, as_json=as_json)


def print_events(
    session: ReadSession,
    listed: Sequence[Event],
    *,
    time_format: TimeFormat | None = None,
    as_json: bool = False,
) -> None:
    """Prints Events as `event list` does, naming their subjects and Machines."""
    labels = subjects.labels(session, listed)
    names = machines.labels(session, {event.recorded_by for event in listed})
    if as_json:
        print_json([_event_json(event, labels, names) for event in listed])
        return
    formatted = time_formatter(time_format, TimeFormat.RELATIVE)
    print_table(
        ["id", "recorded", "machine", "priority", "kind", "subject", "summary"],
        [
            [
                short_id(event.id),
                formatted(event.recorded_at.datetime),
                _machine_text(event, names),
                _priority_text(event.priority),
                event.kind,
                _subject_text(event, labels),
                summary_text(event),
            ]
            for event in listed
        ],
    )


SUMMARY_WIDTH = 60


def _commit_text(commit: str | None) -> str:
    """A commit by its short hash."""
    return "-" if commit is None else commit[:7]


def summary_text(event: Event) -> str:
    """What an Event's payload says, in short, as `event list` shows it.

    Empty for kinds this version doesn't know, and where the subject says it all.
    """
    try:
        kind = EventKind(event.kind)
    except ValueError:
        return ""
    text = _summary(kind, event.payload)
    return text if len(text) <= SUMMARY_WIDTH else f"{text[: SUMMARY_WIDTH - 1]}…"


def _summary(kind: EventKind, payload: dict[str, Any]) -> str:  # noqa: C901, PLR0911, PLR0912 - one case per kind
    """`summary_text` for a kind this version knows."""
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
            return payload["hostname"]
        case EventKind.MOUNT_ADDED:
            return payload["path"]
        case EventKind.REPOSITORY_CHANGED | EventKind.CLONE_REMOTES_CHANGED:
            return ", ".join(f"{name}: {_payload_text(value)}" for name, value in payload.items())
        case EventKind.CLONE_FAILED | EventKind.WORKTREE_FAILED:
            return payload["error"]
        case EventKind.CLONE_BRANCH_CREATED:
            start = payload.get("start")
            return payload["branch"] + (f" from {_commit_text(start)}" if start else "")
        case EventKind.CLONE_BRANCH_DELETED:
            return payload["branch"]
        case (
            EventKind.CLONE_BRANCH_RENAMED
            | EventKind.CLONE_BRANCH_SWITCHED
            | EventKind.WORKTREE_BRANCH_SWITCHED
        ):
            return _payload_text(payload["branch"])
        case EventKind.WORKTREE_ADDED | EventKind.WORKTREE_REMOVED | EventKind.WORKTREE_RESTORED:
            return payload["branch"] or "(detached)"
        case EventKind.WORKTREE_MOVED:
            path = payload["path"]
            return f"{short_path(Path(path['old']))} → {short_path(Path(path['new']))}"
        case EventKind.CLONE_MOVED:
            path = payload.get("display_path") or payload["resolved_path"]
            return f"{short_path(Path(path['old']))} → {short_path(Path(path['new']))}"
        case EventKind.CLONE_COMMITTED | EventKind.WORKTREE_COMMITTED:
            how = "" if payload["how"] == "commit" else f" ({payload['how']})"
            return f"{_commit_text(payload['head']['new'])} {payload['subject']}{how}"
        case EventKind.CLONE_MERGED | EventKind.WORKTREE_MERGED:
            merged = payload["source"] or _commit_text(payload["head"]["new"])
            return merged + (" (fast-forward)" if payload["fast_forward"] else "")
        case EventKind.CLONE_PULLED | EventKind.WORKTREE_PULLED:
            return f"{payload['how']} to {_commit_text(payload['head']['new'])}"
        case EventKind.CLONE_REBASED | EventKind.WORKTREE_REBASED:
            commits = number_text(payload["commits"], "commit")
            onto = payload["onto"]
            return commits + (f" onto {_commit_text(onto)}" if onto else "")
        case EventKind.CLONE_RESET | EventKind.WORKTREE_RESET:
            return f"to {payload['target']}"
        case EventKind.CLONE_HEAD_MOVED | EventKind.WORKTREE_HEAD_MOVED:
            return payload["message"]
        case EventKind.CLONE_PUSHED:
            return f"{payload['branch']} {_commit_text(payload['commit']['new'])}"


def _payload_text(value: Any) -> str:  # noqa: ANN401 - any JSON value
    """A payload value as text; a change as `old → new`."""
    if isinstance(value, dict) and set(value) == {"old", "new"}:  # pyright: ignore[reportUnknownArgumentType]
        return f"{_payload_text(value['old'])} → {_payload_text(value['new'])}"
    return value if isinstance(value, str) else json.dumps(value)


@app.command()
def show(
    event_id: Annotated[
        str, typer.Argument(help="The Event's ID, or its end as `event list` shows it.")
    ],
    *,
    time_format: TimeFormatOption = None,
    as_json: JsonOption = False,
) -> None:
    """Show an Event with its payload."""
    with read_session(Paths.from_environment()) as session:
        event = events.by_short_id(session, event_id)
        labels = subjects.labels(session, [event])
        names = machines.labels(session, [event.recorded_by])
    if as_json:
        print_json(_event_json(event, labels, names))
        return
    formatted = time_formatter(time_format, TimeFormat.FULL)
    print_fields(
        [
            ("id", str(event.id)),
            ("recorded", formatted(event.recorded_at.datetime)),
            ("occurred", "-" if event.occurred_at is None else formatted(event.occurred_at)),
            ("machine", _machine_text(event, names)),
            ("priority", _priority_text(event.priority)),
            ("kind", event.kind),
            ("subject", _subject_text(event, labels)),
            ("subject id", str(event.subject)),
        ]
    )
    if event.payload:
        typer.echo("payload")
        print_fields(
            [(key, _payload_text(value)) for key, value in event.payload.items()], indent="  "
        )
