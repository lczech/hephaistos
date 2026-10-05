import json
import re
import uuid
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated, Any, Literal

import typer

from hephaistos.cli.output import (
    JsonOption,
    TimeFormatOption,
    print_fields,
    print_json,
    print_table,
    short_path,
    time_formatter,
)
from hephaistos.core.config import TimeFormat
from hephaistos.core.db.sessions import read_session
from hephaistos.core.events import events, subjects
from hephaistos.core.events.events import Event
from hephaistos.core.events.kinds import Priority
from hephaistos.core.events.subjects import Label
from hephaistos.core.registry import machines
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
LimitOption = Annotated[
    int, typer.Option("--limit", "-n", min=0, help="Show at most this many; 0 for all.")
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


def _priority(value: int) -> str:
    """A priority by name, or as a number if this version doesn't know it."""
    try:
        return Priority(value).name.lower()
    except ValueError:
        return str(value)


def _label(event: Event, labels: Mapping[uuid.UUID, Label]) -> str:
    """The Event's subject as shown: its label, else its short ID."""
    label = labels.get(event.subject)
    if label is None:
        return short_id(event.subject)
    return short_path(label) if isinstance(label, Path) else label


def _machine(event: Event, names: Mapping[uuid.UUID, str]) -> str:
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
        "machine": names.get(event.recorded_by),
        "priority": event.priority,
        "kind": event.kind,
        "subject": str(event.subject),
        "subject_label": None if label is None else str(label),
        "payload": event.payload,
    }


@app.command("list")
def list_(  # noqa: PLR0913 - one option per filter
    *,
    kind: KindOption = None,
    priority: PriorityOption = None,
    machine: MachineOption = None,
    since: SinceOption = None,
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
        )
        labels = subjects.labels(session, found)
        names = machines.labels(session, {event.recorded_by for event in found})
    if as_json:
        print_json([_event_json(event, labels, names) for event in found])
        return
    formatted = time_formatter(time_format, TimeFormat.RELATIVE)
    print_table(
        ["id", "recorded", "machine", "priority", "kind", "subject"],
        [
            [
                short_id(event.id),
                formatted(event.recorded_at.datetime),
                _machine(event, names),
                _priority(event.priority),
                event.kind,
                _label(event, labels),
            ]
            for event in found
        ],
    )


def _payload_value(value: Any) -> str:  # noqa: ANN401 - any JSON value
    """A payload value as text; a change as `old → new`."""
    if isinstance(value, dict) and set(value) == {"old", "new"}:  # pyright: ignore[reportUnknownArgumentType]
        return f"{_payload_value(value['old'])} → {_payload_value(value['new'])}"
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
            ("machine", _machine(event, names)),
            ("priority", _priority(event.priority)),
            ("kind", event.kind),
            ("subject", _label(event, labels)),
            ("subject id", str(event.subject)),
        ]
    )
    if event.payload:
        typer.echo("payload")
        print_fields(
            [(key, _payload_value(value)) for key, value in event.payload.items()], indent="  "
        )
