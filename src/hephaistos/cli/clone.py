import shlex
from pathlib import Path
from typing import Annotated

import typer

from hephaistos.cli import terminal
from hephaistos.cli.output import (
    JsonOption,
    TimeFormatOption,
    number_text,
    print_fields,
    print_json,
    print_table,
    short_path,
    time_formatter,
)
from hephaistos.core.config import TimeFormat
from hephaistos.core.db.sessions import ReadSession, read_session, write_session
from hephaistos.core.observers import clones as observer
from hephaistos.core.registry import clones, machines, repositories
from hephaistos.core.registry.clones import Candidate, Clone, CloneDetails
from hephaistos.core.state.checkouts import STATUS_COLUMNS, CheckoutState
from hephaistos.core.state.worktrees import WorktreeState
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.ids import id_datetime, short_id
from hephaistos.core.utils.paths import Paths, shell_path

app = typer.Typer(no_args_is_help=True, help="Clones: git clones of Repositories.")

HERE = Path()
PathArgument = Annotated[
    Path,
    typer.Argument(help="A path in the Clone or its Worktrees. Default: the current directory."),
]
RepoOption = Annotated[str | None, typer.Option("--repo", "-r", help="Name of the Repository.")]


ImportHistoryOption = Annotated[
    bool,
    typer.Option(
        "--import-history",
        help="Record the git activity the reflogs still hold, rather than from now on.",
    ),
]
RefreshOption = Annotated[
    bool, typer.Option("--refresh", help="Observe first, rather than show the last observation.")
]


def note_observed(result: observer.Result, reason: str) -> None:
    """Says on stderr that a command observed first, unasked, and why."""
    events = number_text(len(result.events), "Event")
    typer.echo(f"Observed first, as {reason} ({events})", err=True)


def observe_checkout(paths: Paths, path: Path, *, refresh: bool) -> None:
    """Observes the Clone of `path` if asked, or if git knows more than the record."""
    result = observer.observe_checkout(paths, path, refresh=refresh)
    if result is not None and not refresh:
        note_observed(result, "git knows more than the record")


def branch_text(state: CheckoutState) -> str:
    """The branch as shown in lists: its name, or `(detached)`."""
    return state.branch or "(detached)"


def status_text(state: CheckoutState) -> str:
    """The status as lists show it: `clean`, `+2 ~3 ?1 !1 ↑1 ↓2`, or a condition."""
    if not state.present:
        return "missing"
    if state.error is not None:
        return "failed"
    if state.staged is None:
        return "bare"
    counts = (
        ("+", state.staged),
        ("~", state.changed),
        ("?", state.untracked),
        ("!", state.conflicted),
        ("↑", state.ahead),
        ("↓", state.behind),
    )
    return " ".join(f"{symbol}{count}" for symbol, count in counts if count) or "clean"


def _count_text(value: int | None) -> str:
    """A count as `show` prints it; `-` if unknown or not applicable."""
    return "-" if value is None else str(value)


def status_fields(state: CheckoutState) -> list[tuple[str, str]]:
    """A Checkout's status, as `show` prints it."""
    return [
        ("status", status_text(state)),
        ("upstream", state.upstream or "-"),
        ("ahead", _count_text(state.ahead)),
        ("behind", _count_text(state.behind)),
        ("staged", _count_text(state.staged)),
        ("changed", _count_text(state.changed)),
        ("untracked", _count_text(state.untracked)),
        ("conflicted", _count_text(state.conflicted)),
    ]


def _checkout_json(state: CheckoutState) -> dict[str, object]:
    """What Clones and Worktrees share, for JSON output."""
    return {
        "observed_at": state.observed_at.datetime.isoformat(),
        "observed_by": str(state.observed_by),
        "present": state.present,
        "head": state.head,
        "branch": state.branch,
        **{column: getattr(state, column) for column in STATUS_COLUMNS},
        "error": state.error,
    }


def worktree_path_text(worktree: WorktreeState, clone: Clone) -> str:
    """A Worktree's path as shown: relative to its Clone if inside it, else in full."""
    for top in (clone.display_path, clone.resolved_path):
        if worktree.path.is_relative_to(top):
            return str(worktree.path.relative_to(top))
    return short_path(worktree.path)


def worktree_json(worktree: WorktreeState) -> dict[str, object]:
    """A Worktree's State, for JSON output."""
    return {
        "id": str(worktree.id),
        "clone_id": str(worktree.clone_id),
        "name": worktree.name,
        "path": str(worktree.path),
        "lock_reason": worktree.lock_reason,
        **_checkout_json(worktree),
    }


def worktree_lines(details: CloneDetails) -> list[tuple[str, str]]:
    """A Clone's Worktrees, one `show` line each."""
    return [
        (
            "worktree",
            "  ".join(
                [
                    worktree_path_text(worktree, details.clone),
                    branch_text(worktree),
                    status_text(worktree),
                ]
            ),
        )
        for worktree in details.worktrees
    ]


def clone_json(details: CloneDetails) -> dict[str, object]:
    """A Clone with its State and Worktrees, for JSON output."""
    clone, state = details.clone, details.state
    return {
        "id": str(clone.id),
        "repository": details.repository.name,
        "filesystem": details.filesystem.name,
        "path": str(clone.display_path),
        "resolved_path": str(clone.resolved_path),
        "created_at": id_datetime(clone.id).isoformat(),
        "bare": state.bare,
        **_checkout_json(state),
        "branches": list(state.branches),
        "root_commits": list(state.root_commits),
        "remotes": dict(state.remotes),
        "worktrees": [worktree_json(worktree) for worktree in details.worktrees],
    }


def _choose_repository(session: ReadSession, candidate: Candidate) -> str:
    """The Repository to add `candidate` to, from the matching ones, asking the user."""
    matches = [repository.name for repository in clones.matching(session, candidate)]
    shown = short_path(candidate.display_path)
    if not matches:
        raise HephaistosError(
            f"no Repository matches {shown}; add it with a new Repository:\n"
            f"  hephaistos scan {shell_path(candidate.display_path)}"
        )
    if not terminal.interactive():
        raise HephaistosError(f"{shown} matches {', '.join(matches)}; choose one with --repo")
    if len(matches) == 1:
        if not typer.confirm(f"Add {shown} as a Clone of {matches[0]}?", default=True):
            raise typer.Abort
        return matches[0]
    heading = f"{shown} matches several Repositories:"
    return matches[terminal.choose(heading, matches, "Add it as a Clone of")]


@app.command()
def add(
    path: PathArgument = HERE,
    *,
    repo: RepoOption = None,
    import_history: ImportHistoryOption = False,
) -> None:
    """Add a git clone to an existing Repository, and observe it."""
    paths = Paths.from_environment()
    with read_session(paths) as session:
        candidate = clones.inspect(path)
        repository = repo or _choose_repository(session, candidate)
    # Asking happens above, so the write transaction never waits for input.
    with write_session(paths) as session:
        clone = clones.add(session, repository, candidate, import_history=import_history)
    # Observing right away finds its Worktrees and starts its git activity from now.
    result = observer.observe(paths, [clone.id])
    added = f"Added Clone {short_path(clone.display_path)} to {repository}"
    if result.worktrees:
        added += f", with {number_text(result.worktrees, 'Worktree')}"
    if import_history:
        added += f"; imported {number_text(len(result.events), 'Event')} of its history"
    typer.echo(added)


@app.command("list")
def list_(
    *,
    repo: RepoOption = None,
    refresh: RefreshOption = False,
    time_format: TimeFormatOption = None,
    as_json: JsonOption = False,
) -> None:
    """List the Clones."""
    paths = Paths.from_environment()
    if refresh:
        observer.observe(paths)
    with read_session(paths) as session:
        repository_id = repositories.by_name(session, repo).id if repo else None
        found = clones.details(session, repository_id=repository_id)
    if as_json:
        print_json([clone_json(details) for details in found])
        return
    formatted = time_formatter(time_format, TimeFormat.RELATIVE)
    print_table(
        ["repository", "branch", "status", "observed", "filesystem", "path"],
        [
            [
                details.repository.name,
                branch_text(details.state),
                status_text(details.state),
                formatted(details.state.observed_at.datetime),
                details.filesystem.name,
                short_path(details.clone.display_path),
            ]
            for details in found
        ],
    )


@app.command()
def show(
    path: PathArgument = HERE,
    *,
    refresh: RefreshOption = False,
    time_format: TimeFormatOption = None,
    as_json: JsonOption = False,
) -> None:
    """Show the Clone that a path lies in, also through one of its Worktrees."""
    paths = Paths.from_environment()
    observe_checkout(paths, path, refresh=refresh)
    with read_session(paths) as session:
        details = clones.find(session, path)
        observers = machines.labels(session, [details.state.observed_by])
    if as_json:
        print_json(clone_json(details))
        return
    clone, state = details.clone, details.state
    formatted = time_formatter(time_format, TimeFormat.FULL)
    print_fields(
        [
            ("repository", details.repository.name),
            ("id", str(clone.id)),
            ("path", short_path(clone.display_path)),
            ("resolved path", str(clone.resolved_path)),
            ("filesystem", details.filesystem.name),
            ("created", formatted(id_datetime(clone.id))),
            ("observed", formatted(state.observed_at.datetime)),
            ("observed by", observers.get(state.observed_by) or short_id(state.observed_by)),
            ("present", "yes" if state.present else "no"),
            ("bare", "yes" if state.bare else "no"),
            ("head", state.head or "(no commits)"),
            ("branch", branch_text(state)),
            *status_fields(state),
            ("branches", ", ".join(state.branches) or "-"),
            *(("remote", f"{name}  {url}") for name, url in sorted(state.remotes.items())),
            *(("root commit", commit) for commit in state.root_commits),
            ("error", state.error or "-"),
            *worktree_lines(details),
        ]
    )


@app.command()
def remove(path: PathArgument = HERE) -> None:
    """Unregister the Clone that a path lies in; its files stay untouched."""
    with write_session(Paths.from_environment()) as session:
        removed = clones.remove(session, path)
        [summary] = repositories.summaries(session, removed.repository.id)
    name = removed.repository.name
    typer.echo(
        f"Removed Clone {short_path(removed.clone.display_path)} of {name} (files untouched)"
    )
    if not summary.clones:
        typer.echo(
            f"{name} has no Clones left; `hephaistos repo remove {shlex.quote(name)}` removes it"
        )
