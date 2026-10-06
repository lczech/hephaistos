from typing import Annotated

import typer

from hephaistos.cli.clone import branch_text, clone_json, status_text, worktree_lines
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
from hephaistos.core.db.sessions import read_session, write_session
from hephaistos.core.registry import clones, repositories
from hephaistos.core.registry.clones import CloneDetails
from hephaistos.core.registry.repositories import RepositorySummary
from hephaistos.core.utils.ids import id_datetime
from hephaistos.core.utils.paths import Paths

app = typer.Typer(no_args_is_help=True, help="Repositories: projects under git, with their Clones.")

NameArgument = Annotated[str, typer.Argument(help="Name of the Repository.")]


def repo_json(summary: RepositorySummary, its_clones: list[CloneDetails]) -> dict[str, object]:
    """A Repository with its remotes and Clones, for JSON output."""
    repository = summary.repository
    return {
        "id": str(repository.id),
        "name": repository.name,
        "created_at": id_datetime(repository.id).isoformat(),
        "remotes": list(summary.remotes),
        "clones": [clone_json(details) for details in its_clones],
    }


@app.command("list")
def list_(*, as_json: JsonOption = False) -> None:
    """List the Repositories."""
    with read_session(Paths.from_environment()) as session:
        summaries = repositories.summaries(session)
        all_clones = clones.details(session)
    if as_json:
        print_json(
            [
                repo_json(
                    summary,
                    [details for details in all_clones if details.repository == summary.repository],
                )
                for summary in summaries
            ]
        )
        return
    print_table(
        ["name", "clones", "remote"],
        [
            [summary.repository.name, str(summary.clones), ", ".join(summary.remotes) or "-"]
            for summary in summaries
        ],
    )


@app.command()
def show(
    name: NameArgument, *, time_format: TimeFormatOption = None, as_json: JsonOption = False
) -> None:
    """Show a Repository with its remotes and Clones."""
    with read_session(Paths.from_environment()) as session:
        repository = repositories.by_name(session, name)
        [summary] = repositories.summaries(session, repository.id)
        its_clones = clones.details(session, repository_id=repository.id)
    if as_json:
        print_json(repo_json(summary, its_clones))
        return
    formatted = time_formatter(time_format, TimeFormat.FULL)
    print_fields(
        [
            ("name", repository.name),
            ("id", str(repository.id)),
            ("created", formatted(id_datetime(repository.id))),
            *(("remote", remote) for remote in summary.remotes),
            *(
                line
                for details in its_clones
                for line in [
                    (
                        "clone",
                        "  ".join(
                            [
                                short_path(details.clone.display_path),
                                branch_text(details.state),
                                status_text(details.state),
                                details.filesystem.name,
                            ]
                        ),
                    ),
                    *worktree_lines(details),
                ]
            ),
        ]
    )


@app.command()
def add(name: NameArgument) -> None:
    """Add a Repository; then add its Clones with `clone add`."""
    with write_session(Paths.from_environment()) as session:
        repository = repositories.add(session, name)
    typer.echo(f"Added Repository {repository.name}")


@app.command()
def rename(
    name: NameArgument,
    new_name: Annotated[str, typer.Argument(help="The new name.")],
) -> None:
    """Rename a Repository."""
    with write_session(Paths.from_environment()) as session:
        repositories.rename(session, name, new_name)
    typer.echo(f"Renamed Repository {name} to {new_name}")
