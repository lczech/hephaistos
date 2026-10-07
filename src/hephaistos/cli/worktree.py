from pathlib import Path
from typing import Annotated

import typer

from hephaistos.cli import terminal
from hephaistos.cli.clone import (
    RefreshOption,
    RepoOption,
    branch_text,
    note_observed,
    observe_checkout,
    status_fields,
    status_text,
    worktree_json,
    worktree_path_text,
)
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
from hephaistos.core.db.sessions import ReadSession, read_session
from hephaistos.core.observers import clones as observer
from hephaistos.core.registry import clones, machines, repositories
from hephaistos.core.registry.clones import CloneDetails
from hephaistos.core.state.worktrees import WorktreeState
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.ids import short_id
from hephaistos.core.utils.paths import Paths

app = typer.Typer(no_args_is_help=True, help="Worktrees: linked working trees of Clones.")

TargetArgument = Annotated[
    str,
    typer.Argument(
        help="A path in the Worktree, or its name (git's, usually its directory's)."
        " Default: the current directory."
    ),
]


def _json(worktree: WorktreeState, details: CloneDetails) -> dict[str, object]:
    """A Worktree with its Repository and Clone, for JSON output."""
    return {
        "repository": details.repository.name,
        "clone": str(details.clone.display_path),
        **worktree_json(worktree),
    }


def _lock_text(worktree: WorktreeState) -> str:
    """Whether the Worktree is locked, with git's reason if it has one."""
    if worktree.lock_reason is None:
        return "no"
    return worktree.lock_reason or "yes"


@app.command("list")
def list_(
    *,
    repo: RepoOption = None,
    refresh: RefreshOption = False,
    time_format: TimeFormatOption = None,
    as_json: JsonOption = False,
) -> None:
    """List the Worktrees."""
    paths = Paths.from_environment()
    if refresh:
        observer.observe(paths)
    with read_session(paths) as session:
        repository_id = repositories.by_name(session, repo).id if repo else None
        found = [
            (worktree, details)
            for details in clones.details(session, repository_id=repository_id)
            for worktree in details.worktrees
        ]
    if as_json:
        print_json([_json(worktree, details) for worktree, details in found])
        return
    formatted = time_formatter(time_format, TimeFormat.RELATIVE)
    print_table(
        ["repository", "clone", "branch", "status", "observed", "path"],
        [
            [
                details.repository.name,
                short_path(details.clone.display_path),
                branch_text(worktree),
                status_text(worktree),
                formatted(worktree.observed_at.datetime),
                worktree_path_text(worktree, details.clone),
            ]
            for worktree, details in found
        ],
    )


type Found = tuple[WorktreeState, CloneDetails]


def _by_path(session: ReadSession, path: Path) -> Found:
    """The Worktree that `path` lies in, with its Clone."""
    checkout = clones.find_checkout(session, path)
    if checkout.worktree is None:
        shown = short_path(checkout.clone.clone.display_path)
        raise HephaistosError(f"{path} is in the Clone at {shown}, not in a Worktree")
    return checkout.worktree, checkout.clone


def _named(session: ReadSession, name: str) -> list[Found]:
    """The Worktrees with this name, with their Clones."""
    return [
        (worktree, details)
        for details in clones.details(session)
        for worktree in details.worktrees
        if worktree.name == name
    ]


def _by_name(session: ReadSession, name: str) -> Found:
    """The Worktree with this name and its Clone, asking the user if several Clones have one."""
    matches = _named(session, name)
    if not matches:
        raise HephaistosError(f"no Worktree at or named {name}")
    if len(matches) == 1:
        return matches[0]
    shown = [short_path(worktree.path) for worktree, _ in matches]
    if not terminal.interactive():
        raise HephaistosError(
            f"several Worktrees are named {name}; give a path:\n"
            + "\n".join(f"  {path}" for path in shown)
        )
    heading = f"Several Worktrees are named {name}:"
    return matches[terminal.choose(heading, shown, "Show")]


def find_worktree(session: ReadSession, target: str) -> Found:
    """The Worktree at a path, or else with a name, with its Clone."""
    path = Path(target)
    return _by_path(session, path) if path.exists() else _by_name(session, target)


@app.command()
def show(
    target: TargetArgument = ".",
    *,
    refresh: RefreshOption = False,
    time_format: TimeFormatOption = None,
    as_json: JsonOption = False,
) -> None:
    """Show a Worktree."""
    paths = Paths.from_environment()
    if Path(target).exists():
        observe_checkout(paths, Path(target), refresh=refresh)
    elif refresh:
        observer.observe(paths)
    else:
        with read_session(paths) as session:
            known = bool(_named(session, target))
        if not known:
            note_observed(observer.observe(paths), f"no Worktree named {target} was known")
    with read_session(paths) as session:
        worktree, details = find_worktree(session, target)
        observers = machines.labels(session, [worktree.observed_by])
    if as_json:
        print_json(_json(worktree, details))
        return
    formatted = time_formatter(time_format, TimeFormat.FULL)
    print_fields(
        [
            ("repository", details.repository.name),
            ("clone", short_path(details.clone.display_path)),
            ("name", worktree.name),
            ("id", str(worktree.id)),
            ("path", short_path(worktree.path)),
            ("locked", _lock_text(worktree)),
            ("observed", formatted(worktree.observed_at.datetime)),
            ("observed by", observers.get(worktree.observed_by) or short_id(worktree.observed_by)),
            ("present", "yes" if worktree.present else "no"),
            ("head", worktree.head or "(no commits)"),
            ("branch", branch_text(worktree)),
            *status_fields(worktree),
            ("error", worktree.error or "-"),
        ]
    )
