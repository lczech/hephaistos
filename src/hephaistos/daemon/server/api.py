"""The API: what the CLI's commands print with `--json`, as the same JSON, and actions.

Entities are addressed by ID, as names change. Lists come whole, except Events, which page
back with `before`, newest first; the log, back with `before` too; and tables' rows, with
`offset`. A Checkout's changes and a file's diff, only here: in a terminal, git shows them.
"""

import logging
import os
import socket
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Literal, TypedDict, cast

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from hephaistos.core import config, serialize
from hephaistos.core.db import raw
from hephaistos.core.db.sessions import ReadSession, read_session
from hephaistos.core.events import events
from hephaistos.core.events.kinds import Priority, PriorityName
from hephaistos.core.registry import clones, machines
from hephaistos.core.registry.mounts import mounts_of
from hephaistos.core.serialize import (
    API_VERSION,
    ChangesJson,
    CloneJson,
    ConfigJson,
    DiffFilesJson,
    DiffJson,
    DiffsJson,
    EventJson,
    EventKindJson,
    HistoryJson,
    LogJson,
    MachineJson,
    Ref,
    RepositoryJson,
    RowsJson,
    TablesJson,
    WorktreeJson,
)
from hephaistos.core.state import worktrees
from hephaistos.core.utils import changes, history, logs, times
from hephaistos.core.utils.logs import LevelName, ProcessName
from hephaistos.core.utils.paths import Paths, short_path
from hephaistos.daemon import report
from hephaistos.daemon.report import DaemonJson
from hephaistos.daemon.server.errors import CheckoutError, ErrorCheckoutJson, ErrorJson
from hephaistos.daemon.server.live import Hint, Live
from hephaistos.daemon.status import Trigger
from hephaistos.daemon.watcher.worker import Done, PassFailed

DEFAULT_LIMIT = 20  # Events, as `event list` shows
DEFAULT_ROWS = 20  # as `db dump` shows
DEFAULT_RECORDS = 50  # as `log show` shows
DEFAULT_COMMITS = 50  # a page of a history

# Every answer other than success has one shape; declaring it also replaces FastAPI's 422,
# which this Server never sends (`app.py` answers invalid parameters with 400).
router = APIRouter(
    prefix="/api",
    responses={"default": {"model": ErrorJson, "description": "Not a success: the error"}},
)

type Observe = Callable[[Trigger], Awaitable[Done | PassFailed]]  # the Watcher's pass

type Current = Hint | Literal["focus", "reconnect"]

#: What keeps each endpoint's answer current in a GUI: a live connection's hint; asking again
#: when the GUI gains focus, for what changes by hand outside it; or only on reconnecting, for
#: what changes only with the Daemon.
KEPT_CURRENT: dict[str, tuple[Current, ...]] = {
    "/api/info": ("reconnect",),
    "/api/machines": ("data",),
    "/api/machines/{machine_id}": ("data",),
    "/api/repositories": ("data",),
    "/api/repositories/{repository_id}": ("data",),
    "/api/clones": ("data",),
    "/api/clones/{clone_id}": ("data",),
    "/api/worktrees": ("data",),
    "/api/worktrees/{worktree_id}": ("data",),
    "/api/changes": ("data", "focus"),  # focus: files edited, which change no State
    "/api/diff": ("data", "focus"),
    "/api/diff/files": ("data", "focus"),
    "/api/diffs": ("data", "focus"),
    "/api/history": ("data", "focus"),  # focus: commits by hand, between the Watcher's passes
    "/api/events": ("data",),
    "/api/events/kinds": ("reconnect",),
    "/api/events/{event_id}": ("data",),
    "/api/daemon": ("daemon", "focus"),  # focus: its systemd unit
    "/api/config": ("focus",),
    "/api/db/tables": ("data",),
    "/api/db/tables/{table}": ("data",),
    "/api/log": ("log",),
}


class ApiVersionJson(TypedDict):
    """The API's version: clients need the same `major`, and `minor` for what it added."""

    major: int
    minor: int


class InfoJson(TypedDict):
    """What a client checks first: which hephaistos and API answer, on which Machine."""

    version: str
    api: ApiVersionJson
    machine: Ref
    home: str  # this user's home directory here, so clients can show paths as `~/…`


def _not_found(what: str, entity_id: uuid.UUID) -> HTTPException:
    """The error for an ID that names nothing."""
    return HTTPException(404, f"no {what} with ID {entity_id}")


def _absent_clone(session: ReadSession, clone_id: uuid.UUID) -> HTTPException:
    """Why a Clone isn't among the current ones: 410 if it was unregistered, else 404."""
    if not clones.was_unregistered(session, clone_id):
        return _not_found("clone", clone_id)
    where = short_path(clones.paths(session, [clone_id])[clone_id])
    return CheckoutError(
        410,
        f"the clone at {where} was unregistered; its files are untouched",
        ErrorCheckoutJson(clone=str(clone_id), worktree=None, gone="clone"),
    )


def _absent_worktree(session: ReadSession, worktree_id: uuid.UUID) -> HTTPException:
    """Why a Worktree isn't among the current ones: 410 if it or its Clone is gone, else 404."""
    clone_id = worktrees.clone_ids(session, [worktree_id]).get(worktree_id)
    if clone_id is None:
        return _not_found("worktree", worktree_id)
    where = f"the worktree at {short_path(worktrees.paths(session, [worktree_id])[worktree_id])}"
    gone: Literal["clone", "worktree"]
    if clones.was_unregistered(session, clone_id):
        gone, message = "clone", f"the clone of {where} was unregistered; its files are untouched"
    elif worktrees.was_removed(session, worktree_id):
        gone, message = "worktree", f"{where} was removed"
    else:
        return _not_found("worktree", worktree_id)
    checkout = ErrorCheckoutJson(clone=str(clone_id), worktree=str(worktree_id), gone=gone)
    return CheckoutError(410, message, checkout)


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
        home=str(Path.home()),
    )


@router.get("/machines")
def machine_list(paths: PathsOf) -> list[MachineJson]:
    """The Machines, as `machine list --json`."""
    with read_session(paths) as session:
        return serialize.machines_json(session)


@router.get("/machines/{machine_id}")
def machine_show(paths: PathsOf, machine_id: uuid.UUID) -> MachineJson:
    """A Machine, as `machine show --json`; this one with its setup."""
    with read_session(paths) as session:
        try:
            machine = machines.get(session, machine_id)
        except LookupError:
            raise _not_found("machine", machine_id) from None
        this = machine.id == session.machine_id
        return serialize.machine_json(
            machine,
            mounts_of(session, machine.id),
            this=this,
            setup=machines.local_setup(session, paths) if this else None,
        )


@router.get("/repositories")
def repository_list(paths: PathsOf) -> list[RepositoryJson]:
    """The Repositories, as `repo list --json`."""
    with read_session(paths) as session:
        return serialize.repositories_json(session)


@router.get("/repositories/{repository_id}")
def repository_show(paths: PathsOf, repository_id: uuid.UUID) -> RepositoryJson:
    """A Repository, as `repo show --json`."""
    with read_session(paths) as session:
        found = serialize.repositories_json(session, repository_id)
    if not found:
        raise _not_found("repository", repository_id)
    return found[0]


@router.get("/clones")
def clone_list(paths: PathsOf, repository: uuid.UUID | None = None) -> list[CloneJson]:
    """The Clones, or those of a Repository, as `clone list --json`."""
    with read_session(paths) as session:
        return serialize.clones_json(session, repository_id=repository)


@router.get("/clones/{clone_id}")
def clone_show(paths: PathsOf, clone_id: uuid.UUID) -> CloneJson:
    """A Clone, as `clone show --json`."""
    with read_session(paths) as session:
        found = serialize.clones_json(session, clone_id=clone_id)
        if not found:
            raise _absent_clone(session, clone_id)
    return found[0]


@router.get("/worktrees")
def worktree_list(paths: PathsOf, repository: uuid.UUID | None = None) -> list[WorktreeJson]:
    """The Worktrees, or those of a Repository, as `worktree list --json`."""
    with read_session(paths) as session:
        return serialize.worktrees_json(session, repository_id=repository)


@router.get("/worktrees/{worktree_id}")
def worktree_show(paths: PathsOf, worktree_id: uuid.UUID) -> WorktreeJson:
    """A Worktree, as `worktree show --json`."""
    with read_session(paths) as session:
        found = serialize.worktrees_json(session)
        for worktree in found:
            if worktree["id"] == str(worktree_id):
                return worktree
        raise _absent_worktree(session, worktree_id)


def _working_tree(
    paths: Paths, clone: uuid.UUID | None, worktree: uuid.UUID | None, *, bare: bool = False
) -> Path:
    """The working tree of a Clone or a Worktree on this Machine.

    A bare Clone's repository instead, if `bare` allows it, for what only compares commits.
    """
    if (clone is None) == (worktree is None):
        raise HTTPException(400, "give either clone or worktree")
    with read_session(paths) as session:
        local = {details.clone.id for details in clones.on_this_machine(session)}
        for details in clones.details(session):
            if details.clone.id == clone:
                if details.state.bare and not bare:
                    raise HTTPException(
                        400, f"{details.clone.display_path} is bare: no working tree"
                    )
                top, lock = details.clone.resolved_path, None
                what = f"the clone at {short_path(details.clone.display_path)}"
                about = ErrorCheckoutJson(clone=str(clone), worktree=None, gone=None)
            elif found := next((wt for wt in details.worktrees if wt.id == worktree), None):
                top, lock = found.path, found.lock_reason
                what = f"the worktree at {short_path(found.path)}"
                about = ErrorCheckoutJson(
                    clone=str(details.clone.id), worktree=str(worktree), gone=None
                )
            else:
                continue
            if details.clone.id not in local:
                raise CheckoutError(404, f"{what} is on another machine", about)
            if not top.is_dir():
                # A locked Worktree may be away for a while; any other was moved or deleted.
                missing = ": nothing is at its path" if lock is None else f" (locked: {lock})"
                raise CheckoutError(404, f"{what} is missing{missing}", about)
            return top
        if clone is not None:
            raise _absent_clone(session, clone)
        raise _absent_worktree(session, cast("uuid.UUID", worktree))


def _commits_only(from_: str | None, to: str | None, commit: str | None) -> bool:
    """Whether a request compares only commits, which a bare Clone has too."""
    revisions = {from_, to} - {None}
    uncommitted = {changes.INDEX, changes.WORKING_TREE}
    return commit is not None or (bool(revisions) and not revisions & uncommitted)


def _revisions(top: Path, from_: str | None, to: str | None, commit: str | None) -> tuple[str, str]:
    """The revisions compared: `from` and `to`, or a commit's parent and itself."""
    if commit is not None:
        if from_ is not None or to is not None:
            raise HTTPException(400, "give commit, or from and to, not both")
        return changes.commit_revisions(top, commit)
    if from_ is None or to is None:
        raise HTTPException(400, "give from and to, or commit")
    return from_, to


@router.get("/changes")
def changes_show(  # noqa: PLR0913 - one parameter per choice
    paths: PathsOf,
    *,
    clone: uuid.UUID | None = None,
    worktree: uuid.UUID | None = None,
    from_: Annotated[str | None, Query(alias="from")] = None,
    to: str | None = None,
    commit: str | None = None,
    path: str | None = None,
) -> ChangesJson:
    """What changed in a Clone's or Worktree's working tree, as git compares it, read now.

    From one revision to another (`index`, `working-tree`, or a commit, e.g. `HEAD`), or what a
    `commit` changed, with the commit; without them, in the groups `git status` shows. `path`
    limits it to a file or folder in the Checkout.
    """
    top = _working_tree(paths, clone, worktree, bare=_commits_only(from_, to, commit))
    limits = config.settings().gui.diff
    shown = None
    if commit is not None:
        shown = _shown_commit(paths, top, commit)
        if shown["commit"] is None:
            return serialize.changes_json(changes.Changes(None, ()), shown)
        from_, to = _revisions(top, from_, to, shown["commit"]["hash"])
    found = changes.changes(
        top, from_, to, path=path, max_files=limits.max_files, max_bytes=limits.max_bytes
    )
    return serialize.changes_json(found, shown)


def _shown_commit(paths: Paths, top: Path, name: str) -> serialize.ShownCommitJson:
    """A commit asked for, with where amends of it led if no branch, tag or HEAD leads to it."""
    shown = history.commit(top, name)
    amended_as = None
    if not shown.reachable:
        with read_session(paths) as session:
            amended_as = events.amended_as(session, shown.commit.hash if shown.commit else name)
    return serialize.shown_commit_json(name, shown, amended_as)


@router.get("/diff")
def diff_show(  # noqa: PLR0913 - one parameter per choice
    paths: PathsOf,
    *,
    clone: uuid.UUID | None = None,
    worktree: uuid.UUID | None = None,
    from_: Annotated[str | None, Query(alias="from")] = None,
    to: str | None = None,
    commit: str | None = None,
    path: str,
    context: Annotated[int, Query(ge=0)] = 3,
) -> DiffJson:
    """A file's change, as in `/api/changes`, with git's patch: `context` lines around each hunk."""
    top = _working_tree(paths, clone, worktree, bare=_commits_only(from_, to, commit))
    base, target = _revisions(top, from_, to, commit)
    max_bytes = config.settings().gui.diff.max_bytes
    found = changes.diff(top, base, target, path, max_bytes=max_bytes, context=context)
    return serialize.diff_json(found)


@router.get("/diffs")
def diffs_show(  # noqa: PLR0913 - one parameter per choice
    paths: PathsOf,
    *,
    clone: uuid.UUID | None = None,
    worktree: uuid.UUID | None = None,
    from_: Annotated[str | None, Query(alias="from")] = None,
    to: str | None = None,
    commit: str | None = None,
    context: Annotated[int, Query(ge=0)] = 3,
    skip: Annotated[int, Query(ge=0)] = 0,
    new: bool = False,
) -> DiffsJson:
    """The diffs of a comparison's files, as `/api/diff` gives each, but untracked files'.

    A page of them, from `skip` on, up to `gui.diff.max_bytes` in all; `next` asks for the rest.
    With `new`, the files' new versions too, as `/api/diff/files` has them.
    """
    top = _working_tree(paths, clone, worktree, bare=_commits_only(from_, to, commit))
    base, target = _revisions(top, from_, to, commit)
    limits = config.settings().gui.diff
    found = changes.diffs(
        top,
        base,
        target,
        max_files=limits.max_files,
        max_bytes=limits.max_bytes,
        context=context,
        skip=skip,
        new=new,
    )
    return serialize.diffs_json(found)


@router.get("/diff/files")
def diff_files(  # noqa: PLR0913 - one parameter per choice
    paths: PathsOf,
    *,
    clone: uuid.UUID | None = None,
    worktree: uuid.UUID | None = None,
    from_: Annotated[str | None, Query(alias="from")] = None,
    to: str | None = None,
    commit: str | None = None,
    path: str,
) -> DiffFilesJson:
    """A file's contents in both revisions, to show more of it around its changes."""
    top = _working_tree(paths, clone, worktree, bare=_commits_only(from_, to, commit))
    base, target = _revisions(top, from_, to, commit)
    found = changes.versions(
        top, base, target, path, max_bytes=config.settings().gui.diff.max_bytes
    )
    return DiffFilesJson(old=found.old, new=found.new)


@router.get("/history")
def history_show(  # noqa: PLR0913 - one parameter per choice
    paths: PathsOf,
    *,
    clone: uuid.UUID | None = None,
    worktree: uuid.UUID | None = None,
    ref: str | None = None,
    path: str | None = None,
    search: str | None = None,
    everywhere: bool = False,
    start: str | None = None,
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1)] = DEFAULT_COMMITS,
) -> HistoryJson:
    """A Clone's or Worktree's commits, newest first, as `git log` walks back from HEAD.

    Or from `ref`, or `everywhere`: from all branches and tags; with HEAD and the refs there
    are to walk from instead. `path` keeps those that changed a file or folder, following a
    file's renames; `search`, those whose message has all of its words. A search for one hash
    (4 to 40 hex digits) also finds its commit, wherever it is, on the first page. A page's
    `next` gives `start`, `path` and `skip` to go on where it ended, with the same `search`
    and `everywhere`.
    """
    top = _working_tree(paths, clone, worktree, bare=True)
    first = start is None and skip == 0
    if not first and start is None and not everywhere:
        raise HTTPException(400, "give start to go on, unless everywhere")
    after = None if first else history.Next(start, path, skip)
    found = history.history(
        top, ref, path, search=search, everywhere=everywhere, after=after, limit=limit
    )
    named = history.by_hash(top, search, ref, path, everywhere=everywhere) if first else None
    return serialize.history_json(history.refs(top), found, named)


@router.get("/events")
def event_list(  # noqa: PLR0913 - one parameter per filter
    paths: PathsOf,
    *,
    kind: Annotated[list[str] | None, Query()] = None,
    priority: PriorityName | None = None,
    machine: Annotated[list[uuid.UUID] | None, Query()] = None,
    since: str | None = None,
    repository: Annotated[list[uuid.UUID] | None, Query()] = None,
    clone: uuid.UUID | None = None,
    worktree: uuid.UUID | None = None,
    limit: Annotated[int, Query(ge=0)] = DEFAULT_LIMIT,
    before: uuid.UUID | None = None,
) -> list[EventJson]:
    """Events, newest first, as `event list --reverse --json`.

    `before` an Event pages back from it. `kind` as in `event list`; repeat it, `machine` or
    `repository` for several. `since` is a duration (`2h`) or a date; `limit` 0 for all.
    """
    since_time = _time("since", since, datetime.now(UTC))
    with read_session(paths) as session:
        found = events.recent(
            session,
            limit=limit or None,
            kinds=kind or (),
            min_priority=Priority[priority.upper()] if priority else None,
            recorded_by=machine or (),
            since=since_time,
            repository_ids=repository or (),
            clone_id=clone,
            worktree_id=worktree,
            before=before,
        )
        return serialize.events_json(session, found)


@router.get("/events/kinds")
def event_kinds() -> list[EventKindJson]:
    """The kinds of Events this Daemon records, as `event kinds --json`."""
    return serialize.event_kinds_json()


@router.get("/events/{event_id}")
def event_show(paths: PathsOf, event_id: uuid.UUID) -> EventJson:
    """An Event, as `event show --json`."""
    with read_session(paths) as session:
        event = events.get(session, event_id)
        if event is None:
            raise _not_found("event", event_id)
        return serialize.events_json(session, [event])[0]


@router.get("/daemon")
def daemon(paths: PathsOf) -> DaemonJson:
    """How the Daemon is doing, as `daemon status --json`."""
    return report.report_json(report.report(paths, os.environ), datetime.now(UTC))


@router.post("/observe", status_code=204)
async def observe(request: Request) -> None:
    """Observes this Machine in a pass that starts after this request; answers once it ended.

    What changed, the other endpoints show, with what other passes changed; live connections
    get their hints at once.
    """
    outcome = await cast("Observe", request.app.state.observe)("api")
    cast("Live", request.app.state.live).wake()
    if isinstance(outcome, PassFailed):
        raise HTTPException(503, f"the pass failed: {outcome.message}")


@router.get("/config")
def config_show(paths: PathsOf) -> ConfigJson:
    """The settings, as `config show --json` in the Daemon: also what it applies."""
    return serialize.config_json(paths.config_dir, socket.gethostname())


@router.get("/db/tables")
def db_tables(paths: PathsOf) -> TablesJson:
    """The database's tables, as `db tables --json`."""
    with read_session(paths, check_schema=False) as session:
        return serialize.tables_json(session)


@router.get("/db/tables/{table}")
def db_dump(
    paths: PathsOf,
    table: str,
    *,
    column: Annotated[list[str] | None, Query()] = None,
    limit: Annotated[int, Query(ge=0)] = DEFAULT_ROWS,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> RowsJson:
    """A table's rows, newest first, as `db dump --reverse --json`; `offset` skips that many."""
    with read_session(paths, check_schema=False) as session:
        if table not in raw.stored_tables(session):
            raise HTTPException(404, f"no table {table}; `hephaistos db tables` lists them")
        return serialize.rows_json(session, table, column or (), limit or None, offset)


@router.get("/log")
def log_show(  # noqa: PLR0913 - one parameter per filter
    paths: PathsOf,
    *,
    since: str | None = None,
    until: str | None = None,
    level: LevelName | None = None,
    process: ProcessName | None = None,
    pid: int | None = None,
    limit: Annotated[int, Query(ge=0)] = DEFAULT_RECORDS,
    before: str | None = None,
) -> LogJson:
    """The newest records of the log, newest first, as `log show --reverse --json`.

    `before` a record's position pages back from it. `since` and `until` take a duration
    (`2h`) or a date; `limit` 0 for all.
    """
    now = datetime.now(UTC)
    try:
        position = logs.Position.parse(before) if before is not None else None
    except ValueError as error:
        raise HTTPException(400, f"before: {error}") from None
    selection = logs.Selection(
        since=_time("since", since, now),
        until=_time("until", until, now),
        level=logging.getLevelNamesMapping()[level.upper()] if level else logging.NOTSET,
        process=process,
        pid=pid,
    )
    return serialize.log_json(paths.state_dir, selection, limit, position)


def _time(name: str, value: str | None, now: datetime) -> datetime | None:
    """A time parameter, as `--since` takes it; raises HTTPException if it isn't one."""
    if value is None:
        return None
    try:
        return times.parse_time(value, now)
    except ValueError as error:
        raise HTTPException(400, f"{name}: {error}") from None
