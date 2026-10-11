"""The API: what the CLI's `list`, `show` and `status` print with `--json`, as the same JSON.

Entities are addressed by ID, as names change. Lists come whole, except Events, which page
back with `before`, newest first.
"""

import os
import uuid
from datetime import UTC, datetime
from typing import Annotated, TypedDict, cast

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from hephaistos.core import views
from hephaistos.core.db.sessions import read_session
from hephaistos.core.events import events
from hephaistos.core.events.kinds import Priority, PriorityName
from hephaistos.core.registry import machines
from hephaistos.core.registry.mounts import mounts_of
from hephaistos.core.utils import times
from hephaistos.core.utils.paths import Paths
from hephaistos.core.views import (
    API_VERSION,
    CloneJson,
    EventJson,
    MachineJson,
    Ref,
    RepositoryJson,
    WorktreeJson,
)
from hephaistos.daemon import report
from hephaistos.daemon.report import DaemonJson

DEFAULT_LIMIT = 20  # Events, as `event list` shows

router = APIRouter(prefix="/api")


class ApiVersionJson(TypedDict):
    """The API's version: clients need the same `major`, and `minor` for what it added."""

    major: int
    minor: int


class InfoJson(TypedDict):
    """What a client checks first: which hephaistos and API answer, on which Machine."""

    version: str
    api: ApiVersionJson
    machine: Ref


def _not_found(what: str, entity_id: uuid.UUID) -> HTTPException:
    """The error for an ID that names nothing."""
    return HTTPException(404, f"no {what} with ID {entity_id}")


def _paths(request: Request) -> Paths:
    """The paths of the Machine this app serves."""
    return cast("Paths", request.app.state.paths)


PathsOf = Annotated[Paths, Depends(_paths)]


@router.get("/info")
def info(paths: PathsOf, request: Request) -> InfoJson:
    """Which hephaistos and API answer, on which Machine."""
    with read_session(paths) as session:
        machine = machines.this(session)
    return InfoJson(
        version=cast("str", request.app.state.version),
        api=ApiVersionJson(major=API_VERSION.major, minor=API_VERSION.minor),
        machine=Ref(id=str(machine.id), name=machine.name),
    )


@router.get("/machines")
def machine_list(paths: PathsOf) -> list[MachineJson]:
    """The Machines, as `machine list --json`."""
    with read_session(paths) as session:
        return views.machines_json(session)


@router.get("/machines/{machine_id}")
def machine_show(paths: PathsOf, machine_id: uuid.UUID) -> MachineJson:
    """A Machine, as `machine show --json`; this one with its setup."""
    with read_session(paths) as session:
        try:
            machine = machines.get(session, machine_id)
        except LookupError:
            raise _not_found("Machine", machine_id) from None
        this = machine.id == session.machine_id
        return views.machine_json(
            machine,
            mounts_of(session, machine.id),
            this=this,
            setup=machines.local_setup(session, paths) if this else None,
        )


@router.get("/repositories")
def repository_list(paths: PathsOf) -> list[RepositoryJson]:
    """The Repositories, as `repo list --json`."""
    with read_session(paths) as session:
        return views.repositories_json(session)


@router.get("/repositories/{repository_id}")
def repository_show(paths: PathsOf, repository_id: uuid.UUID) -> RepositoryJson:
    """A Repository, as `repo show --json`."""
    with read_session(paths) as session:
        found = views.repositories_json(session, repository_id)
    if not found:
        raise _not_found("Repository", repository_id)
    return found[0]


@router.get("/clones")
def clone_list(paths: PathsOf, repository: uuid.UUID | None = None) -> list[CloneJson]:
    """The Clones, or those of a Repository, as `clone list --json`."""
    with read_session(paths) as session:
        return views.clones_json(session, repository_id=repository)


@router.get("/clones/{clone_id}")
def clone_show(paths: PathsOf, clone_id: uuid.UUID) -> CloneJson:
    """A Clone, as `clone show --json`."""
    with read_session(paths) as session:
        found = views.clones_json(session, clone_id=clone_id)
    if not found:
        raise _not_found("Clone", clone_id)
    return found[0]


@router.get("/worktrees")
def worktree_list(paths: PathsOf, repository: uuid.UUID | None = None) -> list[WorktreeJson]:
    """The Worktrees, or those of a Repository, as `worktree list --json`."""
    with read_session(paths) as session:
        return views.worktrees_json(session, repository_id=repository)


@router.get("/worktrees/{worktree_id}")
def worktree_show(paths: PathsOf, worktree_id: uuid.UUID) -> WorktreeJson:
    """A Worktree, as `worktree show --json`."""
    with read_session(paths) as session:
        found = views.worktrees_json(session)
    for worktree in found:
        if worktree["id"] == str(worktree_id):
            return worktree
    raise _not_found("Worktree", worktree_id)


@router.get("/events")
def event_list(  # noqa: PLR0913 - one parameter per filter
    paths: PathsOf,
    *,
    kind: Annotated[list[str] | None, Query()] = None,
    priority: PriorityName | None = None,
    machine: uuid.UUID | None = None,
    since: str | None = None,
    repository: uuid.UUID | None = None,
    clone: uuid.UUID | None = None,
    worktree: uuid.UUID | None = None,
    limit: Annotated[int, Query(ge=0)] = DEFAULT_LIMIT,
    before: uuid.UUID | None = None,
) -> list[EventJson]:
    """Events, newest first, as `event list --json`; `before` an Event pages back from it.

    `kind` as in `event list` (repeat for several); `since` a duration (`2h`) or a date;
    `limit` 0 for all.
    """
    try:
        since_time = None if since is None else times.parse_time(since, datetime.now(UTC))
    except ValueError as error:
        raise HTTPException(400, f"since: {error}") from None
    with read_session(paths) as session:
        found = events.recent(
            session,
            limit=limit or None,
            kinds=kind or (),
            min_priority=Priority[priority.upper()] if priority else None,
            recorded_by=machine,
            since=since_time,
            repository_id=repository,
            clone_id=clone,
            worktree_id=worktree,
            before=before,
        )
        return views.events_json(session, found)


@router.get("/events/{event_id}")
def event_show(paths: PathsOf, event_id: uuid.UUID) -> EventJson:
    """An Event, as `event show --json`."""
    with read_session(paths) as session:
        event = events.get(session, event_id)
        if event is None:
            raise _not_found("Event", event_id)
        return views.events_json(session, [event])[0]


@router.get("/daemon")
def daemon(paths: PathsOf) -> DaemonJson:
    """How the Daemon is doing, as `daemon status --json`."""
    return report.report_json(report.report(paths, os.environ), datetime.now(UTC))
