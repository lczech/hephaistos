"""Entities as JSON: what `--json` prints and the Server's API returns, built in one place.

These shapes are the API's contract with its clients: API_VERSION counts how they changed.
Other entities are referred to by ID, with a name for showing them.
"""

import uuid
from collections.abc import Collection, Iterable, Mapping, Sequence
from typing import Any, NamedTuple, TypedDict

from hephaistos.core.db.sessions import ReadSession
from hephaistos.core.events import subjects
from hephaistos.core.events.events import Event
from hephaistos.core.events.subjects import Label
from hephaistos.core.registry import clones, machines, repositories
from hephaistos.core.registry.clones import CloneDetails
from hephaistos.core.registry.filesystems import Filesystem
from hephaistos.core.registry.machines import LocalSetup, Machine
from hephaistos.core.registry.mounts import Mount, mounts_of
from hephaistos.core.registry.repositories import RepositorySummary
from hephaistos.core.state.checkouts import CheckoutState
from hephaistos.core.state.worktrees import WorktreeState
from hephaistos.core.utils.ids import id_datetime


class ApiVersion(NamedTuple):
    """The API's version: `major` counts changes that break clients, `minor` additions since."""

    major: int
    minor: int


API_VERSION = ApiVersion(1, 0)


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
    os_machine_id: str | None
    created_at: str
    this: bool
    mounts: list[MountJson]
    setup: SetupJson | None


class _CheckoutJson(TypedDict):
    """What Clones and Worktrees share."""

    observed_at: str
    observed_by: Ref
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
    remotes: list[str]
    clones: list[CloneJson]


class SubjectRef(TypedDict):
    """What an Event is about: its ID, type (`clone`), and name or path if known."""

    id: str
    type: str
    label: str | None


class EventJson(TypedDict):
    """An Event."""

    id: str
    recorded_at: str
    recorded_by: Ref
    occurred_at: str | None
    priority: int
    kind: str
    subject: SubjectRef
    payload: dict[str, Any]
    key: str | None


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
    return machines.labels(session, ids)


def _checkout_json(state: CheckoutState, names: Mapping[uuid.UUID, str]) -> _CheckoutJson:
    """A Checkout's State, as Clones and Worktrees show it."""
    return _CheckoutJson(
        observed_at=state.observed_at.datetime.isoformat(),
        observed_by=machine_ref(state.observed_by, names),
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


def event_json(
    event: Event, labels: Mapping[uuid.UUID, Label], names: Mapping[uuid.UUID, str]
) -> EventJson:
    """An Event; `labels` names its subject and `names` its Machine, where they know them."""
    label = labels.get(event.subject)
    return EventJson(
        id=str(event.id),
        recorded_at=event.recorded_at.datetime.isoformat(),
        recorded_by=machine_ref(event.recorded_by, names),
        occurred_at=None if event.occurred_at is None else event.occurred_at.isoformat(),
        priority=event.priority,
        kind=event.kind,
        subject=SubjectRef(
            id=str(event.subject),
            type=event.subject_type,
            label=None if label is None else str(label),
        ),
        payload=event.payload,
        key=None if event.key is None else event.key.hex(),
    )


def events_json(session: ReadSession, listed: Sequence[Event]) -> list[EventJson]:
    """These Events, naming their subjects and Machines."""
    labels = subjects.labels(session, listed)
    names = machines.labels(session, {event.recorded_by for event in listed})
    return [event_json(event, labels, names) for event in listed]
