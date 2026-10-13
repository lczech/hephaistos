import uuid
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated

import typer

from hephaistos.cli.output import (
    JsonOption,
    LimitOption,
    TimeFormatOption,
    parse_time,
    print_fields,
    print_json,
    print_table,
    time_formatter,
)
from hephaistos.cli.worktree import find_worktree
from hephaistos.core import serialize
from hephaistos.core.config import TimeFormat
from hephaistos.core.db.sessions import ReadSession, read_session
from hephaistos.core.events import events, subjects, summaries
from hephaistos.core.events.events import Event
from hephaistos.core.events.kinds import Priority, PriorityName
from hephaistos.core.events.subjects import Label
from hephaistos.core.registry import clones, machines, repositories
from hephaistos.core.utils.ids import short_id
from hephaistos.core.utils.paths import Paths, short_path

app = typer.Typer(no_args_is_help=True, help="Events: what happened, on any Machine.")

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
    since_time = parse_time(since, datetime.now(UTC)) if since else None
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
    if as_json:
        print_json(serialize.events_json(session, listed))
        return
    labels = subjects.labels(session, listed)
    names = machines.labels(session, {event.recorded_by for event in listed})
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
                _shortened(summaries.summary(event)),
            ]
            for event in listed
        ],
    )


SUMMARY_WIDTH = 60


def _shortened(text: str) -> str:
    """A summary cut to fit the table."""
    return text if len(text) <= SUMMARY_WIDTH else f"{text[: SUMMARY_WIDTH - 1]}…"


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
        if as_json:
            print_json(serialize.events_json(session, [event])[0])
            return
        labels = subjects.labels(session, [event])
        names = machines.labels(session, [event.recorded_by])
    formatted = time_formatter(time_format, TimeFormat.FULL)
    fields = summaries.payload_fields(event.payload)
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
            # A payload that isn't an object, e.g. from another version, is shown whole.
            *([("payload", summaries.value_text(event.payload))] if fields is None else []),
        ]
    )
    if fields:
        typer.echo("payload")
        print_fields(
            [(key, summaries.payload_text(value)) for key, value in fields.items()], indent="  "
        )
