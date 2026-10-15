"""What `--json` prints and the Server's API returns, built in one place.

Entities, and the settings, database and log behind them.

These shapes are the API's contract with its clients: API_VERSION counts how they changed.
Other entities are referred to by ID, with a name for showing them.
"""

import os
import uuid
from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from pathlib import Path
from typing import Any, Literal, NamedTuple, TypedDict, cast

from hephaistos.core import config
from hephaistos.core.db import raw
from hephaistos.core.db.sessions import ReadSession
from hephaistos.core.db.values import ValueType
from hephaistos.core.events import subjects, summaries
from hephaistos.core.events.events import Event
from hephaistos.core.events.kinds import EventKind
from hephaistos.core.registry import clones, machines, repositories
from hephaistos.core.registry.clones import CloneDetails
from hephaistos.core.registry.filesystems import Filesystem
from hephaistos.core.registry.machines import LocalSetup, Machine
from hephaistos.core.registry.mounts import Mount, mounts_of
from hephaistos.core.registry.repositories import RepositorySummary
from hephaistos.core.state.checkouts import CheckoutState
from hephaistos.core.state.worktrees import WorktreeState
from hephaistos.core.utils import logs
from hephaistos.core.utils.ids import Timestamp, id_datetime


class ApiVersion(NamedTuple):
    """The API's version: `major` counts changes that break clients, `minor` additions since.

    While `major` is 0, the API may still change in any way, and `minor` counts every change.
    """

    major: int
    minor: int


API_VERSION = ApiVersion(0, 9)


class Ref(TypedDict):
    """Another entity: its ID, and its name if known (a Machine not yet synced isn't)."""

    id: str
    name: str | None


class CloneRef(TypedDict):
    """A Clone: its ID and path."""

    id: str
    path: str


class MountJson(TypedDict):
    """Where a Machine sees a Filesystem."""

    path: str
    filesystem: Ref


class SetupJson(TypedDict):
    """How this Machine keeps its files and database."""

    config_dir: str
    data_dir: str
    state_dir: str
    database: str
    journal_mode: str
    data_fstype: str
    schema_version: int


class MachineJson(TypedDict):
    """A Machine; `setup` only for this one, where shown."""

    id: str
    name: str
    hostname: str
    chassis: str | None
    os_machine_id: str | None
    created_at: str
    this: bool
    mounts: list[MountJson]
    setup: SetupJson | None


class _CheckoutJson(TypedDict):
    """What Clones and Worktrees share."""

    observed_at: str
    observed_by: Ref
    active_at: str | None
    present: bool
    head: str | None
    branch: str | None
    upstream: str | None
    ahead: int | None
    behind: int | None
    staged: int | None
    changed: int | None
    untracked: int | None
    conflicted: int | None
    error: str | None


class WorktreeJson(TypedDict):
    """A Worktree with its State."""

    id: str
    repository: Ref
    clone: CloneRef
    name: str
    path: str
    lock_reason: str | None
    observed_at: str
    observed_by: Ref
    active_at: str | None
    present: bool
    head: str | None
    branch: str | None
    upstream: str | None
    ahead: int | None
    behind: int | None
    staged: int | None
    changed: int | None
    untracked: int | None
    conflicted: int | None
    error: str | None


class CloneJson(TypedDict):
    """A Clone with its State and Worktrees."""

    id: str
    repository: Ref
    filesystem: Ref
    path: str
    resolved_path: str
    created_at: str
    bare: bool
    observed_at: str
    observed_by: Ref
    active_at: str | None
    present: bool
    head: str | None
    branch: str | None
    upstream: str | None
    ahead: int | None
    behind: int | None
    staged: int | None
    changed: int | None
    untracked: int | None
    conflicted: int | None
    error: str | None
    branches: list[str]
    root_commits: list[str]
    remotes: dict[str, str]
    worktrees: list[WorktreeJson]


class RepositoryJson(TypedDict):
    """A Repository with its main remotes and Clones."""

    id: str
    name: str
    created_at: str
    active_at: str | None
    remotes: list[str]
    clones: list[CloneJson]


class SubjectRef(TypedDict):
    """What an Event is about: its ID, type (`clone`), and its name or its path, if known."""

    id: str
    type: str
    name: str | None  # Machines, Filesystems, Repositories
    path: str | None  # Mounts, Clones, Worktrees


class DetailJson(TypedDict):
    """A field of an Event's payload, as text."""

    field: str
    text: str


class EventJson(TypedDict):
    """An Event."""

    id: str
    recorded_at: str
    recorded_by: Ref
    occurred_at: str | None
    priority: int
    kind: str
    subject: SubjectRef
    repository: Ref | None  # the subject's: itself, or its Clone's or Worktree's
    summary: str  # what the payload says, in short; empty where the subject says it all
    details: list[DetailJson]  # what the payload says, field by field
    payload: dict[str, Any]
    key: str | None


class EventKindJson(TypedDict):
    """A kind of Event this version records, with the priority its Events get."""

    kind: str
    priority: int


def machine_ref(machine_id: uuid.UUID, names: Mapping[uuid.UUID, str]) -> Ref:
    """A Machine, named if `names` knows it."""
    return Ref(id=str(machine_id), name=names.get(machine_id))


def machine_json(
    machine: Machine,
    mounts: Sequence[tuple[Mount, Filesystem]],
    *,
    this: bool,
    setup: LocalSetup | None = None,
) -> MachineJson:
    """A Machine with its mounts, and, if given, this Machine's setup."""
    return MachineJson(
        id=str(machine.id),
        name=machine.name,
        hostname=machine.hostname,
        chassis=machine.chassis,
        os_machine_id=machine.os_machine_id,
        created_at=id_datetime(machine.id).isoformat(),
        this=this,
        mounts=[
            MountJson(path=str(mount.path), filesystem=Ref(id=str(fs.id), name=fs.name))
            for mount, fs in mounts
        ],
        setup=None if setup is None else _setup_json(setup),
    )


def _setup_json(setup: LocalSetup) -> SetupJson:
    """This Machine's setup."""
    paths = setup.paths
    return SetupJson(
        config_dir=str(paths.config_dir),
        data_dir=str(paths.data_dir),
        state_dir=str(paths.state_dir),
        database=str(paths.database),
        journal_mode=setup.journal_mode,
        data_fstype=setup.data_fstype,
        schema_version=setup.schema_version,
    )


def machines_json(session: ReadSession) -> list[MachineJson]:
    """All Machines, sorted by name."""
    return [
        machine_json(machine, mounts_of(session, machine.id), this=machine.id == session.machine_id)
        for machine in machines.listing(session)
    ]


def observer_names(session: ReadSession, found: Iterable[CloneDetails]) -> dict[uuid.UUID, str]:
    """The names of the Machines that observed these Clones and their Worktrees."""
    ids = {state.observed_by for details in found for state in (details.state, *details.worktrees)}
    return machines.names(session, ids)


def _checkout_json(state: CheckoutState, names: Mapping[uuid.UUID, str]) -> _CheckoutJson:
    """A Checkout's State, as Clones and Worktrees show it."""
    return _CheckoutJson(
        observed_at=state.observed_at.datetime.isoformat(),
        observed_by=machine_ref(state.observed_by, names),
        active_at=None if state.active_at is None else state.active_at.isoformat(),
        present=state.present,
        head=state.head,
        branch=state.branch,
        upstream=state.upstream,
        ahead=state.ahead,
        behind=state.behind,
        staged=state.staged,
        changed=state.changed,
        untracked=state.untracked,
        conflicted=state.conflicted,
        error=state.error,
    )


def worktree_json(
    worktree: WorktreeState, details: CloneDetails, names: Mapping[uuid.UUID, str]
) -> WorktreeJson:
    """A Worktree of the Clone in `details`; `names` names the Machines that observed it."""
    repository = details.repository
    return WorktreeJson(
        id=str(worktree.id),
        repository=Ref(id=str(repository.id), name=repository.name),
        clone=CloneRef(id=str(details.clone.id), path=str(details.clone.display_path)),
        name=worktree.name,
        path=str(worktree.path),
        lock_reason=worktree.lock_reason,
        **_checkout_json(worktree, names),
    )


def clone_json(details: CloneDetails, names: Mapping[uuid.UUID, str]) -> CloneJson:
    """A Clone with its Worktrees; `names` names the Machines that observed them."""
    clone, state = details.clone, details.state
    return CloneJson(
        id=str(clone.id),
        repository=Ref(id=str(details.repository.id), name=details.repository.name),
        filesystem=Ref(id=str(details.filesystem.id), name=details.filesystem.name),
        path=str(clone.display_path),
        resolved_path=str(clone.resolved_path),
        created_at=id_datetime(clone.id).isoformat(),
        bare=state.bare,
        **_checkout_json(state, names),
        branches=list(state.branches),
        root_commits=list(state.root_commits),
        remotes=dict(state.remotes),
        worktrees=[worktree_json(worktree, details, names) for worktree in details.worktrees],
    )


def clones_json(
    session: ReadSession,
    *,
    repository_id: uuid.UUID | None = None,
    clone_id: uuid.UUID | None = None,
) -> list[CloneJson]:
    """The Clones, or those of one Repository, or one; sorted by Repository and path."""
    found = clones.details(session, repository_id=repository_id, clone_id=clone_id)
    names = observer_names(session, found)
    return [clone_json(details, names) for details in found]


def worktrees_json(
    session: ReadSession, *, repository_id: uuid.UUID | None = None
) -> list[WorktreeJson]:
    """The Worktrees, or those of one Repository; sorted by Clone, then path."""
    found = clones.details(session, repository_id=repository_id)
    names = observer_names(session, found)
    return [
        worktree_json(worktree, details, names)
        for details in found
        for worktree in details.worktrees
    ]


def repository_json(
    summary: RepositorySummary,
    its_clones: Collection[CloneDetails],
    names: Mapping[uuid.UUID, str],
) -> RepositoryJson:
    """A Repository with its Clones; `names` names the Machines that observed them."""
    repository = summary.repository
    return RepositoryJson(
        id=str(repository.id),
        name=repository.name,
        created_at=id_datetime(repository.id).isoformat(),
        active_at=None if summary.active_at is None else summary.active_at.isoformat(),
        remotes=list(summary.remotes),
        clones=[clone_json(details, names) for details in its_clones],
    )


def repositories_json(
    session: ReadSession, repository_id: uuid.UUID | None = None
) -> list[RepositoryJson]:
    """The Repositories, or one, sorted by name."""
    found = clones.details(session, repository_id=repository_id)
    names = observer_names(session, found)
    return [
        repository_json(
            summary,
            [details for details in found if details.repository.id == summary.repository.id],
            names,
        )
        for summary in repositories.summaries(session, repository_id)
    ]


@dataclass(frozen=True)
class EventContext:
    """What Events refer to, by ID: their subjects' names and paths, Repositories, Machines."""

    names: Mapping[uuid.UUID, str]
    paths: Mapping[uuid.UUID, Path]
    repositories: Mapping[uuid.UUID, uuid.UUID]  # by subject
    repository_names: Mapping[uuid.UUID, str]
    machine_names: Mapping[uuid.UUID, str]

    @classmethod
    def of(cls, session: ReadSession, listed: Sequence[Event]) -> "EventContext":
        """The context of these Events."""
        repository_ids = subjects.repository_ids(session, listed)
        return cls(
            names=subjects.names(session, listed),
            paths=subjects.paths(session, listed),
            repositories=repository_ids,
            repository_names=repositories.names(session, set(repository_ids.values())),
            machine_names=machines.names(session, {event.recorded_by for event in listed}),
        )

    def repository(self, event: Event) -> Ref | None:
        """The Repository the Event's subject belongs to."""
        found = self.repositories.get(event.subject)
        return None if found is None else Ref(id=str(found), name=self.repository_names.get(found))


def event_json(event: Event, context: EventContext) -> EventJson:
    """An Event, with what it refers to named where `context` knows it."""
    path = context.paths.get(event.subject)
    return EventJson(
        id=str(event.id),
        recorded_at=event.recorded_at.datetime.isoformat(),
        recorded_by=machine_ref(event.recorded_by, context.machine_names),
        occurred_at=None if event.occurred_at is None else event.occurred_at.isoformat(),
        priority=event.priority,
        kind=event.kind,
        subject=SubjectRef(
            id=str(event.subject),
            type=event.subject_type,
            name=context.names.get(event.subject),
            path=None if path is None else str(path),
        ),
        repository=context.repository(event),
        summary=summaries.summary(event),
        details=[DetailJson(field=field, text=text) for field, text in summaries.details(event)],
        payload=event.payload,
        key=None if event.key is None else event.key.hex(),
    )


def events_json(session: ReadSession, listed: Sequence[Event]) -> list[EventJson]:
    """These Events, naming what they refer to."""
    context = EventContext.of(session, listed)
    return [event_json(event, context) for event in listed]


def event_kinds_json() -> list[EventKindJson]:
    """Every kind of Event this version records; Peers on a newer one may record others."""
    return [EventKindJson(kind=kind, priority=kind.default_priority) for kind in EventKind]


type SettingValue = bool | int | float | str


class SettingJson(TypedDict):
    """A setting: its value now and where that comes from, and the value this process uses."""

    key: str
    description: str  # from `defaults.toml`
    type: config.SettingType  # in JSON, a `float` may look like an `int`: `30` for 30.0
    value: SettingValue
    source: str  # a file's path, a variable's name, or `default`
    applied: SettingValue  # differs after an edit, until the process starts again


class SourceJson(TypedDict):
    """A config file or variable, in the order they apply."""

    source: str
    kind: Literal["file", "variable"]
    state: Literal["read", "not found", "broken"]
    error: str | None


class UnknownVariableJson(TypedDict):
    """A `HEPHAISTOS_*` variable that isn't a setting's, with the closest one that is."""

    name: str
    closest: str | None


class ConfigJson(TypedDict):
    """The settings as this process finds them, and where they come from."""

    host: str
    settings: list[SettingJson]
    sources: list[SourceJson]
    other_hosts: list[str]  # config files for other hosts, unused here
    unknown_variables: list[UnknownVariableJson]


def _setting_value(value: object) -> SettingValue:
    """A setting's value as JSON gives it: an enumeration as its text."""
    if isinstance(value, StrEnum):
        return value.value
    return cast("SettingValue", value)


def config_json(directory: Path, hostname: str, env: Mapping[str, str] = os.environ) -> ConfigJson:
    """The settings as the files in `directory` for `hostname` and `env` say now.

    Each also with the value this process applies, which it loaded when it started.
    """
    found = config.layers(directory, hostname, env)
    loaded = config.merged(found)
    applied = config.settings()
    return ConfigJson(
        host=hostname,
        settings=[
            SettingJson(
                key=key,
                description=config.DESCRIPTIONS[key],
                type=config.setting_type(key),
                value=_setting_value(loaded.values[key]),
                source=loaded.sources[key],
                applied=_setting_value(config.value_of(applied, key)),
            )
            for key in config.KEYS
        ],
        sources=[
            SourceJson(
                source=layer.source,
                kind="variable" if layer.path is None else "file",
                state=cast("Literal['read', 'not found', 'broken']", layer.state),
                error=None if layer.error is None else str(layer.error),
            )
            for layer in found
        ],
        other_hosts=[str(path) for path in config.other_hosts_files(directory, hostname)],
        unknown_variables=[
            UnknownVariableJson(name=name, closest=closest)
            for name, closest in config.unknown_variables(env).items()
        ],
    )


def stored_value_json(value: object) -> object:
    """A value decoded from the database, for JSON: clock values with their counter."""
    match value:
        case uuid.UUID():
            return str(value)
        case Timestamp():
            return f"{value.datetime.isoformat(timespec='milliseconds')} #{value.counter}"
        case datetime():
            return value.isoformat(timespec="milliseconds")
        case _:
            return value


class TableJson(TypedDict):
    """A table of the database: its category, rows and latest change."""

    table: str
    category: str | None  # None for a table this version doesn't know
    rows: int | None  # None if this version's table is missing
    latest: str | None  # a clock value, as in rows: `2026-10-14T20:27:20.096+00:00 #3`


class TablesJson(TypedDict):
    """The database's tables, and what's unusual about them."""

    tables: list[TableJson]
    warnings: list[str]


class ColumnJson(TypedDict):
    """A table's column, and what its values are: `clock` values are `… #3`, `id`s text."""

    name: str
    type: ValueType


class RowsJson(TypedDict):
    """A table's rows, decoded, newest first."""

    columns: list[ColumnJson]
    rows: list[dict[str, Any]]
    warnings: list[str]


def db_warnings(session: ReadSession, found: Sequence[raw.TableSummary] = ()) -> list[str]:
    """What's unusual about the database: another schema, unknown tables among `found`."""
    warnings: list[str] = []
    if (mismatch := session.schema_mismatch) is not None:
        warnings.append(f"{mismatch}; showing it as stored")
    if unknown := [table.name for table in found if table.category is None]:
        tables = "1 table" if len(unknown) == 1 else f"{len(unknown)} tables"
        warnings.append(f"{tables} not in this version's schema: {', '.join(unknown)}")
    return warnings


def tables_json(session: ReadSession) -> TablesJson:
    """The database's tables: this version's in schema order, then any others."""
    found = raw.tables(session)
    return TablesJson(
        tables=[
            TableJson(
                table=table.name,
                category=table.category,
                rows=table.rows,
                latest=cast("str | None", stored_value_json(table.latest)),
            )
            for table in found
        ],
        warnings=db_warnings(session, found),
    )


def rows_json(
    session: ReadSession,
    table: str,
    columns: Sequence[str] = (),
    limit: int | None = None,
    offset: int = 0,
) -> RowsJson:
    """A table's rows, newest first: only `columns` if given; `offset` skips that many."""
    found = raw.rows(session, table, columns, limit, offset)
    return RowsJson(
        columns=[
            ColumnJson(name=name, type=type_)
            for name, type_ in zip(found.columns, found.types, strict=True)
        ],
        rows=[
            {name: stored_value_json(value) for name, value in zip(found.columns, row, strict=True)}
            for row in found.values
        ],
        warnings=db_warnings(session),
    )


class LogEntryJson(TypedDict):
    """A log record as written, and where its line starts: day and byte, `2026-10-14:18734`."""

    position: str
    record: dict[str, Any]


class LogJson(TypedDict):
    """Log entries, newest first, and how many lines weren't records."""

    entries: list[LogEntryJson]
    skipped: int


def log_entry_json(entry: logs.Entry) -> LogEntryJson:
    """A log record and its position."""
    return LogEntryJson(position=str(entry.position), record=entry.record)


def log_json(
    directory: Path,
    selection: logs.Selection,
    limit: int = 0,
    before: logs.Position | None = None,
) -> LogJson:
    """The newest `limit` selected records of the log in `directory` (0: all), newest first.

    `before` a record's position pages back from it.
    """
    reading = logs.read(directory, selection, limit, before=before)
    return LogJson(
        entries=[log_entry_json(entry) for entry in reading.entries], skipped=reading.skipped
    )
