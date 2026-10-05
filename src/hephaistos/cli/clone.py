import shlex
from pathlib import Path
from typing import Annotated

import typer

from hephaistos.cli import terminal
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
from hephaistos.core.db.sessions import ReadSession, read_session, write_session
from hephaistos.core.observers import clones as observer
from hephaistos.core.registry import clones, machines, repositories
from hephaistos.core.registry.clones import Candidate, CloneDetails
from hephaistos.core.state.checkouts import CheckoutState
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.ids import id_datetime, short_id
from hephaistos.core.utils.paths import Paths

app = typer.Typer(no_args_is_help=True, help="Clones: git clones of Repositories.")

HERE = Path()
PathArgument = Annotated[
    Path, typer.Argument(help="A path in the Clone. Default: the current directory.")
]
RepoOption = Annotated[str | None, typer.Option("--repo", "-r", help="Name of the Repository.")]


RefreshOption = Annotated[
    bool, typer.Option("--refresh", help="Observe first, rather than show the last observation.")
]


def branch_text(details: CloneDetails) -> str:
    """The branch as shown in lists: its name, or `(detached)`."""
    return details.state.branch or "(detached)"


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


def clone_json(details: CloneDetails) -> dict[str, object]:
    """A Clone with its State, for JSON output."""
    clone, state = details.clone, details.state
    return {
        "id": str(clone.id),
        "repository": details.repository.name,
        "filesystem": details.filesystem.name,
        "path": str(clone.display_path),
        "resolved_path": str(clone.resolved_path),
        "created_at": id_datetime(clone.id).isoformat(),
        "observed_at": state.observed_at.datetime.isoformat(),
        "observed_by": str(state.observed_by),
        "present": state.present,
        "bare": state.bare,
        "head": state.head,
        "branch": state.branch,
        "upstream": state.upstream,
        "ahead": state.ahead,
        "behind": state.behind,
        "staged": state.staged,
        "changed": state.changed,
        "untracked": state.untracked,
        "conflicted": state.conflicted,
        "branches": list(state.branches),
        "root_commits": list(state.root_commits),
        "remotes": dict(state.remotes),
        "error": state.error,
    }


def _choose_repository(session: ReadSession, path: Path, candidate: Candidate) -> str:
    """The Repository to add `candidate` to, from the matching ones, asking the user."""
    matches = [repository.name for repository in clones.matching(session, candidate)]
    shown = short_path(candidate.display_path)
    if not matches:
        name = shlex.quote(candidate.suggested_name)
        raise HephaistosError(
            f"no Repository matches {shown}; add one first:\n"
            f"  hephaistos repo add {name}\n"
            f"  hephaistos clone add {shlex.quote(str(path))} --repo {name}"
        )
    if not terminal.interactive():
        raise HephaistosError(f"{shown} matches {', '.join(matches)}; choose one with --repo")
    if len(matches) == 1:
        if not typer.confirm(f"Add {shown} as a Clone of {matches[0]}?", default=True):
            raise typer.Abort
        return matches[0]
    typer.echo(f"{shown} matches several Repositories:")
    for number, name in enumerate(matches, start=1):
        typer.echo(f"  {number}  {name}")
    while True:
        number: int = typer.prompt("Add it as a Clone of", type=int)
        if 1 <= number <= len(matches):
            return matches[number - 1]


@app.command()
def add(path: PathArgument = HERE, *, repo: RepoOption = None) -> None:
    """Add a git clone to an existing Repository."""
    paths = Paths.from_environment()
    with read_session(paths) as session:
        candidate = clones.inspect(path)
        repository = repo or _choose_repository(session, path, candidate)
    # Asking happens above, so the write transaction never waits for input.
    with write_session(paths) as session:
        clone = clones.add(session, repository, candidate)
    typer.echo(f"Added Clone {short_path(clone.display_path)} to {repository}")


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
                branch_text(details),
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
    """Show the Clone that a path lies in."""
    paths = Paths.from_environment()
    if refresh:
        with read_session(paths) as session:
            clone_id = clones.find(session, path).clone.id
        observer.observe(paths, [clone_id])
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
            ("branch", branch_text(details)),
            ("status", status_text(state)),
            ("upstream", state.upstream or "-"),
            ("ahead", _count_text(state.ahead)),
            ("behind", _count_text(state.behind)),
            ("staged", _count_text(state.staged)),
            ("changed", _count_text(state.changed)),
            ("untracked", _count_text(state.untracked)),
            ("conflicted", _count_text(state.conflicted)),
            ("branches", ", ".join(state.branches) or "-"),
            *(("remote", f"{name}  {url}") for name, url in sorted(state.remotes.items())),
            *(("root commit", commit) for commit in state.root_commits),
            ("error", state.error or "-"),
        ]
    )


@app.command()
def remove(path: PathArgument = HERE) -> None:
    """Unregister the Clone that a path lies in; its files stay untouched."""
    with write_session(Paths.from_environment()) as session:
        removed = clones.remove(session, path)
    typer.echo(
        f"Removed Clone {short_path(removed.clone.display_path)} of {removed.repository.name}"
        " (files untouched)"
    )
