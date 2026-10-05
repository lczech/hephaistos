from typing import Annotated

import typer

from hephaistos.cli.clone import clone_json
from hephaistos.cli.output import (
    JsonOption,
    full_time,
    print_fields,
    print_json,
    print_table,
    short_path,
)
from hephaistos.core.db.sessions import read_session, write_session
from hephaistos.core.registry import clones, repositories
from hephaistos.core.utils.ids import id_datetime
from hephaistos.core.utils.paths import Paths

app = typer.Typer(no_args_is_help=True, help="Repositories: projects under git, with their Clones.")

NameArgument = Annotated[str, typer.Argument(help="Name of the Repository.")]


@app.command("list")
def list_(*, as_json: JsonOption = False) -> None:
    """List the Repositories."""
    with read_session(Paths.from_environment()) as session:
        summaries = repositories.summaries(session)
    if as_json:
        print_json(
            [
                {"id": str(summary.repository.id), "name": summary.repository.name}
                | {"clones": summary.clones}
                for summary in summaries
            ]
        )
        return
    print_table(
        ["name", "clones"],
        [[summary.repository.name, str(summary.clones)] for summary in summaries],
    )


@app.command()
def show(name: NameArgument, *, as_json: JsonOption = False) -> None:
    """Show a Repository and its Clones."""
    with read_session(Paths.from_environment()) as session:
        repository = repositories.by_name(session, name)
        its_clones = clones.details(session, repository_id=repository.id)
    created = id_datetime(repository.id)
    if as_json:
        print_json(
            {
                "id": str(repository.id),
                "name": repository.name,
                "created": created.isoformat(),
                "clones": [clone_json(details) for details in its_clones],
            }
        )
        return
    print_fields(
        [
            ("name", repository.name),
            ("id", str(repository.id)),
            ("created", full_time(created)),
            *(
                ("clone", f"{short_path(details.clone.display_path)}  {details.filesystem.name}")
                for details in its_clones
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
