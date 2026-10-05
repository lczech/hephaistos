import shlex
import sys
from pathlib import Path
from typing import Annotated

import typer

from hephaistos.cli.output import (
    JsonOption,
    full_time,
    print_fields,
    print_json,
    print_table,
    short_path,
)
from hephaistos.core.db.sessions import ReadSession, read_session, write_session
from hephaistos.core.registry import clones, repositories
from hephaistos.core.registry.clones import Candidate, CloneDetails
from hephaistos.core.utils.errors import HephaistosError
from hephaistos.core.utils.ids import id_datetime
from hephaistos.core.utils.paths import Paths

app = typer.Typer(no_args_is_help=True, help="Clones: git clones of Repositories.")

HERE = Path()
PathArgument = Annotated[
    Path, typer.Argument(help="A path in the Clone. Default: the current directory.")
]
RepoOption = Annotated[str | None, typer.Option("--repo", "-r", help="Name of the Repository.")]


def _branch(details: CloneDetails) -> str:
    """The branch as shown in lists: its name, or `(detached)`."""
    return details.state.branch or "(detached)"


def clone_json(details: CloneDetails) -> dict[str, object]:
    """A Clone with its State, for JSON output."""
    clone, state = details.clone, details.state
    return {
        "id": str(clone.id),
        "repository": details.repository.name,
        "filesystem": details.filesystem.name,
        "path": str(clone.display_path),
        "resolved_path": str(clone.resolved_path),
        "created": id_datetime(clone.id).isoformat(),
        "observed": state.observed_at.datetime.isoformat(),
        "present": state.present,
        "bare": state.bare,
        "head": state.head,
        "branch": state.branch,
        "root_commits": list(state.root_commits),
        "remotes": dict(state.remotes),
        "error": state.error,
    }


def _interactive() -> bool:
    """Whether we can ask the user."""
    return sys.stdin.isatty()


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
    if not _interactive():
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
def list_(*, repo: RepoOption = None, as_json: JsonOption = False) -> None:
    """List the Clones."""
    with read_session(Paths.from_environment()) as session:
        repository_id = repositories.by_name(session, repo).id if repo else None
        found = clones.details(session, repository_id=repository_id)
    if as_json:
        print_json([clone_json(details) for details in found])
        return
    print_table(
        ["repository", "branch", "path"],
        [
            [details.repository.name, _branch(details), short_path(details.clone.display_path)]
            for details in found
        ],
    )


@app.command()
def show(path: PathArgument = HERE, *, as_json: JsonOption = False) -> None:
    """Show the Clone that a path lies in."""
    with read_session(Paths.from_environment()) as session:
        details = clones.find(session, path)
    if as_json:
        print_json(clone_json(details))
        return
    clone, state = details.clone, details.state
    print_fields(
        [
            ("repository", details.repository.name),
            ("id", str(clone.id)),
            ("path", short_path(clone.display_path)),
            *(
                [("resolved path", str(clone.resolved_path))]
                if clone.resolved_path != clone.display_path
                else []
            ),
            ("filesystem", details.filesystem.name),
            ("created", full_time(id_datetime(clone.id))),
            ("observed", full_time(state.observed_at.datetime)),
            *([("bare", "yes")] if state.bare else []),
            ("head", state.head or "(no commits)"),
            ("branch", _branch(details)),
            *(("remote", f"{name}  {url}") for name, url in sorted(state.remotes.items())),
            *(("root commit", commit) for commit in state.root_commits),
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
