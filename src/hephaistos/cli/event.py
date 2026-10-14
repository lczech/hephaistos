from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated

import typer

from hephaistos.cli.output import (
    JsonOption,
    LimitOption,
    ReverseOption,
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
from hephaistos.core.events import events, summaries
from hephaistos.core.events.events import Event
from hephaistos.core.events.kinds import Priority, PriorityName
from hephaistos.core.registry import clones, machines, repositories
from hephaistos.core.serialize import EventContext
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
    list[str] | None,
    typer.Option(
        "--machine", "-m", help="Only Events recorded by this Machine. Repeat for several."
    ),
]
SinceOption = Annotated[
    str | None,
    typer.Option("--since", "-s", help="Only Events since then: `30m`, `2h`, `3d`, or a date."),
]
RepoFilterOption = Annotated[
    list[str] | None,
    typer.Option(
        "--repo",
        "-r",
        help="Only Events about this Repository, its Clones and their Worktrees."
        " Repeat for several.",
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


def _subject_text(event: Event, context: EventContext) -> str:
    """The Event's subject as shown: its name or path, else its short ID."""
    if (name := context.names.get(event.subject)) is not None:
        return name
    if (path := context.paths.get(event.subject)) is not None:
        return short_path(path)
    return short_id(event.subject)


def _repository_text(event: Event, context: EventContext) -> str:
    """The Repository of the Event's subject, if it has one: its name, else its short ID."""
    found = context.repositories.get(event.subject)
    return "" if found is None else context.repository_names.get(found) or short_id(found)


def _machine_text(event: Event, context: EventContext) -> str:
    """The name of the Machine that recorded the Event, else its short ID."""
    return context.machine_names.get(event.recorded_by) or short_id(event.recorded_by)


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
    reverse: ReverseOption = False,
    time_format: TimeFormatOption = None,
    as_json: JsonOption = False,
) -> None:
    """List the newest Events, oldest first."""
    since_time = parse_time(since, datetime.now(UTC)) if since else None
    with read_session(Paths.from_environment()) as session:
        found = events.recent(
            session,
            limit=limit or None,
            kinds=kind or (),
            min_priority=Priority[priority.upper()] if priority else None,
            recorded_by=[machines.by_name(session, name).id for name in machine or ()],
            since=since_time,
            repository_ids=[repositories.by_name(session, name).id for name in repo or ()],
            clone_id=clones.find_unobserved(session, clone).clone.id if clone else None,
            worktree_id=find_worktree(session, worktree)[0].id if worktree else None,
        )
        listed = found if reverse else found[::-1]
        print_events(session, listed, time_format=time_format, as_json=as_json)


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
    context = EventContext.of(session, listed)
    formatted = time_formatter(time_format, TimeFormat.RELATIVE)
    print_table(
        ["id", "recorded", "priority", "kind", "repository", "machine", "subject", "summary"],
        [
            [
                short_id(event.id),
                formatted(event.recorded_at.datetime),
                _priority_text(event.priority),
                event.kind,
                _repository_text(event, context),
                _machine_text(event, context),
                # A Repository's own Events: its name is in the column before.
                "" if event.subject_type == "repository" else _subject_text(event, context),
                summaries.summary(event, SUMMARY_WIDTH),
            ]
            for event in listed
        ],
    )


SUMMARY_WIDTH = 60


@app.command()
def kinds(*, as_json: JsonOption = False) -> None:
    """List the kinds of Events, with the priority their Events get."""
    listed = serialize.event_kinds_json()
    if as_json:
        print_json(listed)
        return
    print_table(
        ["kind", "priority"], [[kind["kind"], _priority_text(kind["priority"])] for kind in listed]
    )


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
        context = EventContext.of(session, [event])
    formatted = time_formatter(time_format, TimeFormat.FULL)
    fields = summaries.payload_fields(event.payload)
    print_fields(
        [
            ("id", str(event.id)),
            ("recorded", formatted(event.recorded_at.datetime)),
            ("occurred", "-" if event.occurred_at is None else formatted(event.occurred_at)),
            ("priority", _priority_text(event.priority)),
            ("kind", event.kind),
            ("repository", _repository_text(event, context) or "-"),
            ("machine", _machine_text(event, context)),
            ("subject", _subject_text(event, context)),
            ("subject id", str(event.subject)),
            # A payload that isn't an object, e.g. from another version, is shown whole.
            *([("payload", summaries.value_text(event.payload))] if fields is None else []),
        ]
    )
    if fields:
        typer.echo("payload")
        print_fields(summaries.details(event), indent="  ")
